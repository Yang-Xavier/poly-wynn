import { waitFor } from "@shared/utils/waitFor";
import { TRADE_ACTION_ENUM } from "@shared/constants";
import { TCreds } from "@shared/encryptConfig";
import { Position } from "@shared/trade/Position";
import TradeCore, { TBriefOrder } from "@shared/trade/TradeCore";
import TradeReport from "@shared/trade/TradeReport";
import { TradeTask, TradeTaskManage } from "@shared/trade/TradeTaskManage";
import { UserWs } from "@shared/ws/UserWs";

export interface TraderConfig {
  appName: string;
  privKey: string;
  clobCreds: TCreds;
  funderAddress: string;
  userWs: UserWs;
  signatureType?: number;
  roundEndTimestamp: number;
  logInfo: (message: string) => void;
}

export default class Trader {
  public tradeTaskManage: TradeTaskManage;
  public position: Position;
  public tradeReport: TradeReport;
  public tradeCore: TradeCore;
  public maxTradeAmount: number = 100;
  public traceId: string;

  private logInfo: (message: string) => void;

  constructor({
    appName,
    privKey,
    signatureType = 1,
    clobCreds,
    funderAddress,
    userWs,
    roundEndTimestamp,
    logInfo,
  }: TraderConfig) {
    this.logInfo = logInfo;
    this.tradeTaskManage = new TradeTaskManage({
      tradeTaskExecutor: (task: TradeTask) => this.executeTradeTask(task),
      taskEndTimestamp: roundEndTimestamp,
      onTrade: (task: TradeTask, remainTasks: TradeTask[]) => this.onTrade(task, remainTasks),
    });
    this.tradeReport = new TradeReport({ appName });
    this.position = new Position();
    this.tradeCore = new TradeCore({
      privKey,
      signatureType,
      clobCreds,
      funderAddress,
      userWs,
      logInfo,
    });
  }

  private async executeTradeTask(task: TradeTask) {
    try {
      let order: TBriefOrder | null = null;
      if (task.action === TRADE_ACTION_ENUM.buy) {
        if (this.getTradeLimitation().canBuy) {
          this.tradeTaskManage.clearTasks(task.action, task.outcome);
          return;
        }
        order = await this.tradeCore.marketBuyAndWaitFill({
          tokenId: task.tokenId,
          price: task.price,
          amount: task.amount,
        });
      }
      if (task.action === TRADE_ACTION_ENUM.sell) {
        if (this.getTradeLimitation().canSell) {
          this.tradeTaskManage.clearTasks(task.action, task.outcome);
          return;
        }
        order = await this.tradeCore.marketSellAndWaitFill({
          tokenId: task.tokenId,
          price: task.price,
          size: task.size,
        });
      }

      if (order) {
        this.position.addTrade({
          action: task.action,
          size: order.size,
          price: order.price,
          outcome: order.outcome,
          fee: order.fee,
          amount: order.amount,
        });
        this.tradeReport.addReport("trade", {
          action: task.action,
          timestamp: order.timestamp,
          price: order.price,
          size: order.size,
          outcome: order.outcome,
          fee: order.fee,
        });
        this.logInfo(`[🙏executeTradeTask] 交易任务完成: ${JSON.stringify(task)}`);
        this.logInfo(`[🙏executeTradeTask] 订单信息: ${JSON.stringify(order)}`);
        this.logInfo(
          `[🙏executeTradeTask] 当前持仓信息: ${JSON.stringify(this.position.getPosition())}`
        );
      }
    } catch (error) {
      this.logInfo(`[🙏executeTradeTask] 执行交易任务失败: ${error}`);
    }
  }

  // 继承,重写
  onTrade(task: TradeTask, remainTasks: TradeTask[]) {
    return;
  }

  // 继承,重写
  getTradeLimitation() {
    return { canBuy: true, canSell: true };
  }

  get remainAmount() {
    return this.maxTradeAmount - this.position.getPosition().amount;
  }

  setTraceId(traceId: string) {
    this.traceId = traceId;
    this.tradeReport.setTraceId(traceId);
  }

  setUserWs(userWs: UserWs) {
    this.tradeCore.setUserWs(userWs);
  }

  setMaxTradeAmount(maxTradeAmount: number) {
    this.maxTradeAmount = maxTradeAmount;
  }

  clear() {
    this.tradeTaskManage.clearTasks();
    this.position.reset();
    this.tradeReport.cleanOldReports();
  }
}

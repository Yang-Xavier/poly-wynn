import { OUTCOMES_ENUM, TRADE_ACTION_ENUM } from "@shared/constants";
import { TBriefOrder } from "./TradeCore";

/**
 * 交易任务接口
 */
export interface TradeTask {
  tokenId: string; // 交易 tokenId
  action: TRADE_ACTION_ENUM; // 交易动作：买入或卖出
  price: number; // 交易价格
  outcome: OUTCOMES_ENUM; // 交易结果：Up 或 Down
  size?: number; // 交易数量
  amount?: number; // 交易数量
}

export interface TradeTaskExecutor {
  (task: TradeTask): Promise<TBriefOrder | null>;
}

export interface IOnTradeFinished {
  (task: TradeTask, order: TBriefOrder): void;
}

/**
 * 交易任务管理类
 */
export class TradeTaskManage {
  // 任务列表
  private taskList: TradeTask[] = [];
  private tradeTaskExecutor: TradeTaskExecutor;
  private runningTaskAction: TRADE_ACTION_ENUM | null = null;
  private taskEndTimestamp: number | null = null;
  private onTradeFinished: IOnTradeFinished;
  constructor({
    taskEndTimestamp,
    tradeTaskExecutor,
    onTradeFinished,
  }: {
    tradeTaskExecutor: TradeTaskExecutor;
    taskEndTimestamp: number;
    onTradeFinished?: IOnTradeFinished;
  }) {
    this.tradeTaskExecutor = tradeTaskExecutor;
    this.taskEndTimestamp = taskEndTimestamp;
    this.onTradeFinished = onTradeFinished;
  }

  getRunningTaskAction(): TRADE_ACTION_ENUM | null {
    return this.runningTaskAction;
  }

  /**
   * 添加任务到任务列表
   * @param task 交易任务
   */
  addTask(task: TradeTask): void {
    this.taskList.push(task);
    this.autoRunNextTask();
  }

  /**
   * 运行下一个任务
   * @returns 返回任务对象，如果没有任务则返回 null
   */
  async autoRunNextTask(): Promise<number> {
    if (this.taskList.length === 0 || Date.now() > this.taskEndTimestamp) {
      this.clearTasks();
      return;
    }

    const task = this.taskList.shift()!;
    this.runningTaskAction = task.action;
    const order = await this.tradeTaskExecutor(task);
    this.runningTaskAction = null;
    this.onTradeFinished?.(task, order);
    this.autoRunNextTask();
  }

  /**
   * 清空任务
   */
  clearTasks(action?: TRADE_ACTION_ENUM, outcome?: OUTCOMES_ENUM): void {
    if (action && outcome) {
      this.taskList = this.taskList.filter(
        (task) => !(task.action === action && task.outcome === outcome)
      );
    } else if (action) {
      this.taskList = this.taskList.filter((task) => task.action !== action);
    } else if (outcome) {
      this.taskList = this.taskList.filter((task) => task.outcome !== outcome);
    } else {
      this.taskList = [];
    }
  }
}

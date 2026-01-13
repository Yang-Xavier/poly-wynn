import { getTrader } from "@crypto15min/module/traderCtrl";
import { logError, logInfo } from "../module/logger";
import { redeemWithRelayer } from "./relayerRedeem";

import gammaApi from "@shared/api/gammaApi";
import { TReportResult } from "@shared/trade/TradeReport";

/**
 * 赎回任务类型
 */
export type RedeemTask = {
  traceId: string; // 用作 marketSlug
  conditionId: string;
  outcome: string; // 购买的 outcome（例如 "Up" 或 "Down"）
  isSold: boolean; // 是否已卖出
};

/**
 * 赎回任务管理器
 */
class RedeemTaskManager {
  private tasks: RedeemTask[] = [];

  /**
   * 添加赎回任务
   * @param traceId 跟踪ID（用作 marketSlug）
   * @param conditionId 市场条件ID
   * @param outcome 购买的 outcome
   */
  addTask(traceId: string, conditionId: string, outcome: string, isSold: boolean): void {
    // 检查是否已存在相同 traceId 的任务
    const existingTask = this.tasks.find((task) => task.traceId === traceId);
    if (existingTask) {
      logInfo(`[RedeemTask] 任务已存在，跳过添加: ${traceId}`);
      return;
    }

    this.tasks.push({
      traceId,
      conditionId,
      outcome,
      isSold,
    });
    logInfo(`[RedeemTask] 添加任务: ${traceId}, conditionId: ${conditionId}, outcome: ${outcome}`);
  }

  /**
   * 执行赎回任务
   * 遍历所有任务，查询市场信息，对比 outcome，执行赎回或更新结果
   */
  async runCheckResultAndRedeem(): Promise<void> {
    if (this.tasks.length === 0) {
      logInfo(`[RedeemTask] 没有待处理的任务`);
      return;
    }

    logInfo(`[RedeemTask] 开始执行赎回任务，共 ${this.tasks.length} 个任务`);

    const remainingTasks: RedeemTask[] = [];

    for (let i = 0; i < this.tasks.length; i++) {
      const task = this.tasks[i];
      try {
        getTrader().tradeReport.setTraceId(task.traceId);
        logInfo(`[RedeemTask] 处理第 ${i + 1}/${this.tasks.length} 个任务: ${task.traceId}`);

        // 使用 traceId 作为 marketSlug 查询市场信息
        const market = await gammaApi.getMarketBySlug(task.traceId);
        if (!market || !market.closed) {
          logError(`[RedeemTask] 市场尚未关闭，稍后重试: ${task.traceId}`);
          remainingTasks.push(task);
          continue;
        } else {
          // 解析市场结果
          const { outcomes, outcomePrices } = market;
          const finalOutcomes = JSON.parse(outcomes) as string[];
          const finalOutcomePrices = JSON.parse(outcomePrices).map(Number) as number[];
          const outcomePrice = Math.max(...finalOutcomePrices);
          const finalOutcome =
            finalOutcomes[finalOutcomePrices.findIndex((item) => Number(item) === outcomePrice)];

          logInfo(
            `[RedeemTask] 市场结果: ${task.traceId}, 最终结果: ${finalOutcome}, 购买结果: ${task.outcome}`
          );

          // 对比购买的 outcome 是否与市场最终结果一致, 且未卖出
          if (task.outcome === finalOutcome) {
            // 结果一致，执行赎回
            logInfo(
              `[RedeemTask] 结果匹配，开始赎回: ${task.traceId}, conditionId: ${task.conditionId}`
            );
            try {
              const { transactionHash, rawResult } = await redeemWithRelayer(task.conditionId);
              if (transactionHash) {
                logInfo(
                  `[RedeemTask] 赎回成功: ${task.traceId}, transactionHash: ${transactionHash}`
                );
                let resultPayload: TReportResult;
                if (task.isSold) {
                  resultPayload = {
                    result: "sold",
                    additionalInfo: "won",
                  };
                } else {
                  resultPayload = {
                    result: "won",
                    additionalInfo: "",
                  };
                }
                getTrader().tradeReport.addReport("result", resultPayload);
              } else {
                logError(
                  `[RedeemTask] 赎回失败: ${task.traceId}. rawResult: ${JSON.stringify(rawResult)}`
                );
                remainingTasks.push(task);
              }
            } catch (error) {
              logError(`[RedeemTask] 赎回异常: ${task.traceId}, error: ${error}`);
              remainingTasks.push(task);
            }
          } else {
            // 结果不一致，更新报告结果
            logInfo(
              `[RedeemTask] 结果不匹配，更新报告: ${task.traceId}, 最终结果: ${finalOutcome}, 购买结果: ${task.outcome}`
            );

            // 更新结果为 "lost"（因为购买的 outcome 与最终结果不一致）

            let resultPayload: TReportResult;
            if (task.isSold) {
              resultPayload = {
                result: "sold",
                additionalInfo: "lost",
              };
            } else {
              resultPayload = {
                result: "lost",
                additionalInfo: "",
              };
            }
            getTrader().tradeReport.addReport("result", resultPayload);
          }
        }
      } catch (error) {
        logError(`[RedeemTask] 处理任务失败: ${task.traceId}, error: ${error}`);
        // 如果处理失败，保留任务以便稍后重试
        remainingTasks.push(task);
      }
    }

    // 更新任务列表，保留未完成的任务
    this.tasks = remainingTasks;
    logInfo(`[RedeemTask] 赎回任务执行完成，剩余 ${this.tasks.length} 个任务待处理`);
  }

  /**
   * 获取当前任务数量
   */
  getTaskCount(): number {
    return this.tasks.length;
  }

  /**
   * 清空所有任务
   */
  clearTasks(): void {
    this.tasks = [];
    logInfo(`[RedeemTask] 已清空所有任务`);
  }
}

// 导出单例实例
export default new RedeemTaskManager();

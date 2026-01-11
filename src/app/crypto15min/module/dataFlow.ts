import { BnPriceWs } from "@shared/ws/BnPriceWs";
import { PolyPriceWs } from "@shared/ws/PolyPriceWs";
import { PolyOrderBookWs } from "@shared/ws/PolyOrderBookWs";
import { IWsLogger } from "@shared/ws/HighPerformanceWs";
import dataRecord from "./dataRecord";
import { UserWs } from "@shared/ws/UserWs";
import { getConfig } from "@crypto15min/utils/config";

import { customTypeLog, logData, logError, logInfo } from "./logger";

/**
 * 数据流实例接口
 */
export interface DataFlowInstances {
  bnPriceWs: BnPriceWs;
  polyPriceWs: PolyPriceWs;
  polyOrderBookWs: PolyOrderBookWs;
  userWs: UserWs;
}

// 全局变量：存储数据流实例（单例）
let dataFlowInstances: DataFlowInstances | null = null;

/**
 * 初始化数据流实例（单例模式）
 * @param params 初始化参数
 * @returns 数据流实例
 */
export function initializeDataFlow(params: {
  logger?: IWsLogger; // Logger 实例
  symbol: string; // 币种符号, 如 'eth'
}): DataFlowInstances {
  // 如果已经初始化，返回现有实例
  if (dataFlowInstances) {
    return dataFlowInstances;
  }
  const config = getConfig();

  const {
    logger = {
      logInfo: logInfo,
      logError: logError,
      logData: logData,
      customTypeLog: customTypeLog,
    },
  } = params;

  // 创建币安价格 WebSocket 实例
  const bnPriceWs = new BnPriceWs({
    logger,
    symbol: `${params.symbol}usdt`,
    windowTime: 100,
    dataRecord,
  });

  // 创建 Polymarket 价格 WebSocket 实例
  const polyPriceWs = new PolyPriceWs({
    logger,
    windowTime: 100,
    dataRecord,
  });

  // 创建 Polymarket 订单簿 WebSocket 实例
  const polyOrderBookWs = new PolyOrderBookWs({
    logger,
    windowTime: 50,
    dataRecord,
  });

  // 创建用户交易 WebSocket 实例
  const userWs = new UserWs({
    logger,
    windowTime: 50,
    dataRecord,
    auth: {
      apiKey: config.account.clobCreds.key,
      secret: config.account.clobCreds.secret,
      passphrase: config.account.clobCreds.passphrase,
    },
  });

  dataFlowInstances = {
    bnPriceWs,
    polyPriceWs,
    polyOrderBookWs,
    userWs,
  };

  return dataFlowInstances;
}

/**
 * 获取数据流实例
 * @returns 数据流实例，如果未初始化则返回 null
 */
export function getDataFlowInstances(): DataFlowInstances | null {
  return dataFlowInstances;
}

/**
 * 销毁数据流实例
 */
export function destroyDataFlow(): void {
  if (dataFlowInstances) {
    // 清理所有 WebSocket 连接
    dataFlowInstances.bnPriceWs.cleanup();
    dataFlowInstances.polyPriceWs.cleanup();
    dataFlowInstances.polyOrderBookWs.cleanup();
    dataFlowInstances.userWs.cleanup();
    // 清空实例
    dataFlowInstances = null;
  }
}

import { BnPriceWs } from "@shared/ws/BnPriceWs";
import { PolyPriceWs } from "@shared/ws/PolyPriceWs";
import { PolyOrderBookWs } from "@shared/ws/PolyOrderBookWs";
import { IWsLogger } from "@shared/ws/HighPerformanceWs";
import { DataRecords } from "@shared/DataRecords";
import { UserWs } from "@shared/ws/UserWs";
import { getConfig } from "@spreadArbitrage/config";

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

const initialize = (params: {
  logger: IWsLogger;
  symbol: string;
  dataRecord: DataRecords;
}): DataFlowInstances => {
  const { logger } = params;
  const config = getConfig();

  // 创建币安价格 WebSocket 实例
  const bnPriceWs = new BnPriceWs({
    logger,
    symbol: `${params.symbol}usdt`,
    windowTime: 100,
    dataRecord: params.dataRecord,
  });

  // 创建 Polymarket 价格 WebSocket 实例
  const polyPriceWs = new PolyPriceWs({
    logger,
    windowTime: 100,
    dataRecord: params.dataRecord,
  });

  // 创建 Polymarket 订单簿 WebSocket 实例
  const polyOrderBookWs = new PolyOrderBookWs({
    logger,
    windowTime: 50,
    dataRecord: params.dataRecord,
  });

  // 创建 User Ws 实例
  const userWs = new UserWs({
    logger,
    auth: {
      apiKey: config.account.clobCreds.key,
      secret: config.account.clobCreds.secret,
      passphrase: config.account.clobCreds.passphrase,
    },
    dataRecord: params.dataRecord,
  });

  dataFlowInstances = {
    bnPriceWs,
    polyPriceWs,
    polyOrderBookWs,
    userWs,
  };

  return dataFlowInstances;
};

const getInstances = (): DataFlowInstances | null => {
  return dataFlowInstances;
};

const destroy = (): void => {
  if (dataFlowInstances) {
    dataFlowInstances.bnPriceWs.cleanup();
    dataFlowInstances.polyPriceWs.cleanup();
    dataFlowInstances.polyOrderBookWs.cleanup();
    dataFlowInstances.userWs.cleanup();
  }
  dataFlowInstances = null;
};

export default {
  initialize,
  getInstances,
  destroy,
};

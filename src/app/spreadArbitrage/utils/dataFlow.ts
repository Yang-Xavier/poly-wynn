import { BnPriceWs } from "@shared/ws/BnPriceWs";
import { PolyPriceWs } from "@shared/ws/PolyPriceWs";
import { PolyOrderBookWs } from "@shared/ws/PolyOrderBookWs";
import { IWsLogger } from "@shared/ws/HighPerformanceWs";

/**
 * 数据流实例接口
 */
export interface DataFlowInstances {
  bnPriceWs: BnPriceWs;
  polyPriceWs: PolyPriceWs;
  polyOrderBookWs: PolyOrderBookWs;
}

// 全局变量：存储数据流实例（单例）
let dataFlowInstances: DataFlowInstances | null = null;

const initialize = (params: { logger: IWsLogger; symbol: string }): DataFlowInstances => {
  const { logger } = params;

  // 创建币安价格 WebSocket 实例
  const bnPriceWs = new BnPriceWs({
    logger,
    symbol: `${params.symbol}usdc`,
    windowTime: 100,
  });

  // 创建 Polymarket 价格 WebSocket 实例
  const polyPriceWs = new PolyPriceWs({
    logger,
    windowTime: 100,
  });

  // 创建 Polymarket 订单簿 WebSocket 实例
  const polyOrderBookWs = new PolyOrderBookWs({
    logger,
    windowTime: 50,
  });

  dataFlowInstances = {
    bnPriceWs,
    polyPriceWs,
    polyOrderBookWs,
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
  }
  dataFlowInstances = null;
};

export default {
  initialize,
  getInstances,
  destroy,
};

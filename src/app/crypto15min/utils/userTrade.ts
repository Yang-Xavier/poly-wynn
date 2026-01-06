import { getDataFlowInstances } from "@crypto15min/module/dataFlow";
import { logInfo } from "@crypto15min/module/logger";
import { getClobModule } from "../module/clob";

export const waitForOrderMatched = async (orderId?: string, timeout: number = 30 * 1000) => {
  logInfo(`监听订单成交状态...${orderId}`);
  let resolved = false;
  return new Promise((resolve) => {
    const timer = setTimeout(async () => {
      if (resolved) return;
      const order = await getClobModule().getOrder({ orderId });
      logInfo(`订单成交状态...${JSON.stringify(order)}`);
      resolved = true;
      resolve(order);
    }, timeout);

    getDataFlowInstances().userWs.onUserTrade((trade) => {
      if (resolved) return;
      logInfo(`监听到有订单推送...${JSON.stringify(trade)}`);
      if (trade.taker_order_id === orderId) {
        const order = {
          ...trade,
          size_matched: trade.size,
          original_size: trade.size,
          original_price: trade.price,
          orderId: trade.taker_order_id,
        };

        logInfo(`订单成交...${JSON.stringify(order)}`);
        resolved = true;
        resolve(order);
        clearTimeout(timer);
      }
    });
  });
};

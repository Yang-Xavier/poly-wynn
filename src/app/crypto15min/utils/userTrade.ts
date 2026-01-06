import { getDataFlowInstances } from "@crypto15min/module/dataFlow";
import { logInfo } from "@crypto15min/module/logger";
import clobApi from "@shared/api/clobApi";
import { race } from "@shared/utils/race";

export const waitForOrderMatched = async (orderId: string, timeout: number = 30 * 1000) => {
  logInfo(`监听订单成交状态...${orderId}`);
  let resolved = false;
  return race(
    new Promise((resolve) => {
      getDataFlowInstances().userWs.onUserTrade((trade) => {
        logInfo(`监听订单成交状态...${JSON.stringify(trade)}`);
        if (resolved) return;
        trade.maker_orders.forEach((order) => {
          if (order.order_id === orderId) {
            const orderResult = Object.assign(order, {
              size_matched: (order as any).size_matched || order.matched_amount,
              original_size: (order as any).size_matched || order.matched_amount,
              original_price: order.price,
            });
            logInfo(`订单成交...${JSON.stringify(order)}`);
            resolved = true;
            resolve(orderResult);
          }
        });
      });
    }),
    timeout,
    async () => {
      logInfo(`监听超时，查询订单成交状态...${orderId}`);
      const order = await clobApi.getOrder({ orderId });
      logInfo(`订单成交状态...${JSON.stringify(order)}`);
      return order;
    }
  );
};

import clobApi from "@shared/api/clobApi";
import { calcFee } from "@shared/utils/calcFee";
import { UserWs } from "@shared/ws/UserWs";
import { IOrderData } from "@typings/orderData";

export type TOrderResult = IOrderData & { received_size: number };

export const waitForOrderMatched = async ({
  orderId,
  userWs,
  logInfo = console.log,
  timeout = 30 * 1000,
}: {
  orderId: string;
  userWs: UserWs;
  logInfo?: (message: string) => void;
  timeout?: number;
}) => {
  logInfo(`监听订单成交状态...${orderId}`);
  let resolved = false;
  return new Promise((resolve) => {
    const timer = setTimeout(async () => {
      if (resolved) return;
      const order = (await clobApi.getOrder({ orderId })) as TOrderResult;
      logInfo(`订单成交状态...${JSON.stringify(order)}`);
      resolved = true;
      order.received_size =
        Number(order.size_matched) -
        calcFee({
          price: Number(order.price),
          matchedAmount: order.size_matched,
        });
      resolve(order as TOrderResult);
    }, timeout);

    userWs.onUserTrade((trade) => {
      if (resolved) return;
      logInfo(`监听到有订单推送...${JSON.stringify(trade)}`);
      if (trade.taker_order_id === orderId) {
        const order = {
          ...trade,
          received_size: trade.maker_orders.reduce(
            (acc, curr) =>
              acc +
              Number(curr.matched_amount) -
              calcFee({ price: Number(curr.price), matchedAmount: curr.matched_amount }),
            0
          ),
          size_matched: trade.maker_orders.reduce(
            (acc, curr) => acc + Number(curr.matched_amount),
            0
          ),
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

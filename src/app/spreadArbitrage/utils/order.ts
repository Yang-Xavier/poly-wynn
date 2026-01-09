import { Side } from "@polymarket/clob-client";
import clobApi from "@shared/api/clobApi";
import { waitFor } from "@shared/utils/waitFor";
import { logInfo } from "@spreadArbitrage/logger";
import dataFlow from "./dataFlow";
import { IOrderData } from "@typings/orderData";

export const mustGetOrder = async (orderId: string, timeout: number) => {
  const startTime = Date.now();
  let retryCount = 0;
  logInfo(`查询订单...`, { orderId });
  while (new Date().getTime() - startTime < timeout) {
    try {
      const resp = await clobApi.getOrder({ orderId });
      if (resp) {
        return resp;
      }
    } catch (err) {
      logInfo(`第${retryCount}次查询订单失败...`, { err });
      retryCount++;
    }
    await waitFor(1000);
  }
  return null;
};

export const waitForOrderMatched = async (orderId?: string, timeout: number = 30 * 1000) => {
  logInfo(`监听订单成交状态...${orderId}`);
  let resolved = false;
  return new Promise((resolve) => {
    const timer = setTimeout(async () => {
      if (resolved) return;
      const order = await clobApi.getOrder({ orderId });
      logInfo(`订单成交状态...${JSON.stringify(order)}`);
      resolved = true;
      resolve(order as IOrderData);
    }, timeout);

    dataFlow.getInstances()?.userWs.onUserTrade((trade) => {
      if (resolved) return;
      logInfo(`监听到有订单推送...${JSON.stringify(trade)}`);
      if (trade.taker_order_id === orderId) {
        const order = {
          ...trade,
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
        resolve(order as unknown as IOrderData);
        clearTimeout(timer);
      }
    });
  });
};

export const buy = async (assetId: string, price: number, amount: number) => {
  try {
    logInfo(`下单...`, { assetId, price, amount });
    const resp = await clobApi.postMarketOrder({ tokenID: assetId, price, side: Side.BUY, amount });
    logInfo(`下单完成...`, { resp });
    return resp;
  } catch (err) {
    logInfo(`下单失败...`, { err });
    return null;
  }
};

export const buyUntilMatched = async (assetId: string, price: number, amount: number) => {
  const result = await buy(assetId, price, amount);
  if (result?.orderID) {
    return await waitForOrderMatched(result.orderID);
  }
  return null;
};

export const sellLimitOrder = async (tokenID: string, price: number, size: number) => {
  try {
    logInfo(`下单...`, { tokenID, price, size });
    const resp = await clobApi.postOrder({ tokenID, side: Side.SELL, price, size });
    logInfo(`下单完成...`, { resp });
    return resp;
  } catch (err) {
    logInfo(`下单失败...`, { err });
    return null;
  }
};

export const mustSell = async (
  boughtOrder: IOrderData,
  price: number,
  timeout: number = 60 * 1000
) => {
  const { asset_id, size_matched } = boughtOrder;
  const startTime = Date.now();
  let retryCount = 0;
  while (new Date().getTime() - startTime < timeout) {
    try {
      logInfo(`卖出... sellPrice: ${price}, ${JSON.stringify(boughtOrder)}`);
      const resp = await clobApi.postMarketOrder({
        tokenID: asset_id,
        side: Side.SELL,
        amount: Number(size_matched),
        price,
      });
      logInfo(`卖出完成...`, { resp });
      if (resp.orderID) {
        return resp;
      }
    } catch (err) {
      logInfo(`第${retryCount}次卖出失败...`, { err });
      retryCount++;
    }
  }
  return null;
};

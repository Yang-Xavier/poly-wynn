import { Side } from "@polymarket/clob-client";
import clobApi from "@shared/api/clobApi";
import { waitFor } from "@shared/utils/waitFor";
import { logInfo } from "@spreadArbitrage/logger";
import { TOrderResult, waitForOrderMatched } from "@shared/utils/waitForOrderMatched";
import dataFlow from "./dataFlow";

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
    return await waitForOrderMatched({
      orderId: result.orderID,
      userWs: dataFlow.getInstances().userWs,
      logInfo,
    });
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
  boughtOrder: TOrderResult,
  price: number,
  timeout: number = 60 * 1000
) => {
  const { asset_id, received_size } = boughtOrder;
  const startTime = Date.now();
  let retryCount = 0;
  while (new Date().getTime() - startTime < timeout) {
    try {
      logInfo(`卖出... sellPrice: ${price}, ${JSON.stringify(boughtOrder)}`);
      const resp = await clobApi.postMarketOrder({
        tokenID: asset_id,
        side: Side.SELL,
        amount: Number(received_size),
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

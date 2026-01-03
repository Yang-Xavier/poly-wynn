import { Side } from "@polymarket/clob-client";
import clobApi from "@shared/api/clobApi";
import { waitFor } from "@shared/utils/waitFor";
import { logInfo } from "@spreadArbitrage/logger";

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
    const resp = await clobApi.postMarketOrder({ tokenID: assetId, side: Side.BUY, amount });
    logInfo(`下单完成...`, { resp });
    return resp;
  } catch (err) {
    logInfo(`下单失败...`, { err });
    return null;
  }
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

export const mustSell = async (assetId: string, amount: number, timeout: number = 60 * 1000) => {
  const startTime = Date.now();
  let retryCount = 0;
  while (new Date().getTime() - startTime < timeout) {
    try {
      logInfo(`卖出...`);
      const resp = await clobApi.postMarketOrder({ tokenID: assetId, side: Side.SELL, amount });
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

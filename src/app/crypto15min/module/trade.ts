import { OrderType, Side } from "@polymarket/clob-client";
import { getClobModule } from "./clob";
import { logError, logInfo } from "./logger";
import { distanceToNextInterval, waitFor } from "@crypto15min/utils/tools";
import { getGlobalConfig } from "@crypto15min/utils/config";
import { getGammaDataModule } from "./gammaData";
import tradeReport from "@crypto15min/module/tradeReport";
import { TOrderResult, waitForOrderMatched } from "@shared/utils/waitForOrderMatched";
import { getDataFlowInstances } from "./dataFlow";

export const buy = async ({
  tokenId,
  amount,
  retryCount = 1,
  slugIntervalTimestamp,
}: {
  tokenId: string;
  amount?: number;
  retryCount?: number;
  slugIntervalTimestamp: number;
}): Promise<TOrderResult | null> => {
  let result: TOrderResult | null = null;
  const clobModule = getClobModule();
  let count = retryCount;

  while (!result && count > 0 && distanceToNextInterval(slugIntervalTimestamp) > 0) {
    try {
      logInfo(`🙏尝试购买... 第${retryCount - count + 1} / ${retryCount} 次`);
      const { orderID } = await clobModule.postMarketOrder({
        tokenID: tokenId,
        amount,
        side: Side.BUY,
        orderType: OrderType.FAK,
      });
      if (orderID) {
        const timestamp = Date.now();
        result = (await waitForOrderMatched({
          orderId: orderID,
          userWs: getDataFlowInstances().userWs,
          logInfo,
        })) as TOrderResult;
        logInfo(`购买完成...`, { orderID });

        tradeReport.addReport("trade", {
          action: "buy",
          price: Number(result?.price),
          amount: Number(result?.received_size || result?.size_matched || result?.original_size),
          outcome: result?.outcome,
          timestamp,
        });
      }
      logInfo(`购买结果: ${JSON.stringify(result || {})}`);
    } catch (e) {
      logInfo(`购买失败...${e}`);
    }
    count--;
  }
  return result;
};

export const buyEnough = async ({
  tokenId,
  amount,
  slugIntervalTimestamp,
}: {
  tokenId: string;
  amount: number;
  slugIntervalTimestamp: number;
}): Promise<TOrderResult | null> => {
  const globalConfig = getGlobalConfig();
  const buyResults: TOrderResult[] = [];
  let buyCount = globalConfig.stratgegy.buyingMaxSplit;
  let remainAmount = amount;

  while (buyCount > 0 && distanceToNextInterval(slugIntervalTimestamp) > 0) {
    buyCount--;
    const buyResult = await buy({
      tokenId,
      amount: remainAmount,
      retryCount: globalConfig.stratgegy.buyingRetryCount,
      slugIntervalTimestamp,
    });

    if (buyResult) {
      buyResults.push(buyResult);
      remainAmount = remainAmount - Number(buyResult?.size_matched) * Number(buyResult?.price);
    }
    logInfo(
      `第 ${globalConfig.stratgegy.buyingMaxSplit - buyCount} / ${globalConfig.stratgegy.buyingMaxSplit} 笔购买, 本次购买: ${Number(buyResult?.size_matched) * Number(buyResult?.price)}, 剩余购买额度: ${remainAmount}/${amount}`,
      buyResult
    );
    if (remainAmount <= 1) {
      break;
    }
  }

  const totalReceivedSize = buyResults.reduce((acc, curr) => acc + Number(curr.received_size), 0);
  const totalSizeMatched = buyResults.reduce((acc, curr) => acc + Number(curr.size_matched), 0);
  const totalPriceAmount = buyResults.reduce(
    (acc, curr) => acc + Number(curr.price) * Number(curr.size_matched),
    0
  );
  const avgPrice = totalPriceAmount / totalSizeMatched;
  const lastBuyResult = buyResults[buyResults.length - 1];

  if (lastBuyResult && lastBuyResult.status.toUpperCase() === "MATCHED") {
    return Object.assign(lastBuyResult, {
      size_matched: totalSizeMatched,
      received_size: totalReceivedSize,
      price: avgPrice,
    });
  }
  return null;
};

export const mustSell = async ({
  tokenId,
  amount,
  slugIntervalTimestamp,
}: {
  tokenId: string;
  amount?: number;
  slugIntervalTimestamp?: number;
}): Promise<TOrderResult | null> => {
  let result: TOrderResult | null = null;
  let count = 0;

  while (!result && distanceToNextInterval(slugIntervalTimestamp) > 0) {
    logInfo(`尝试卖出, 第 ${++count} 次...`);
    try {
      const clobModule = getClobModule();
      const resp = await clobModule.postMarketOrder({
        tokenID: tokenId,
        amount,
        side: Side.SELL,
        orderType: OrderType.FAK,
      });
      if (resp.orderID) {
        const timestamp = Date.now();
        logInfo(`卖出完成...`, { orderID: resp.orderID });
        result = (await waitForOrderMatched(resp.orderID)) as TOrderResult;
        logInfo(`卖出结果: ${JSON.stringify(result || {})}`);
        tradeReport.addReport("trade", {
          action: "sell",
          price: Number(result?.price),
          amount: Number(result?.size_matched || result?.original_size || amount),
          outcome: result?.outcome,
          timestamp,
        });
      }
    } catch (e) {
      logInfo(`sell failed! ${e}`);
    }
  }

  return result;
};

export const sellExpired30MinPostions = async () => {
  const globalConfig = getGlobalConfig();
  const positions = await getGammaDataModule().getExpired30MinPositions({
    funderAddress: globalConfig.account.funderAddress,
  });
  if (positions.length === 0) {
    logInfo(`没有过期仓位需要卖出...`);
    return;
  }
  logInfo(`有 ${positions.length} 个过期仓位需要卖出...`);
  try {
    for (const position of positions) {
      await getClobModule().postOrder({
        tokenID: position.asset,
        size: Number(position.size),
        price: 0.99,
        side: Side.SELL,
        orderType: OrderType.FAK,
      });
    }
  } catch (error) {
    logError(`过期仓位卖出失败: ${error}`);
  }

  logInfo(`过期仓位卖出完成...`);
};

// export const limitBuy = async ({
//   tokenId,
//   amount,
//   retryCount = 5,
//   price = 0.99,
//   slugIntervalTimestamp,
// }: {
//   tokenId: string;
//   amount: number;
//   price: number;
//   retryCount?: number;
//   slugIntervalTimestamp: number;
// }): Promise<PolymarketOrderResult | null> => {
//   let result: PolymarketOrderResult | null = null;
//   const clobModule = getClobModule();
//   let count = retryCount;

//   while (!result && count > 0 && distanceToNextInterval(slugIntervalTimestamp) > 0) {
//     try {
//       logInfo(`🙏尝试挂单购买... 第${retryCount - count + 1} / ${retryCount} 次`);
//       const { orderID } = await clobModule.postOrder({
//         tokenID: tokenId,
//         side: Side.BUY,
//         price: price,
//         size: amount,
//         orderType: OrderType.GTC,
//       });
//       logInfo(`挂单成功...`, { orderID, price, amount });
//       if (orderID) {
//         const MAX_CHECK_COUNT = 10;
//         let count = MAX_CHECK_COUNT;
//         while (count-- > 0) {
//           await waitFor(500);
//           logInfo(`检查订单状态... 第${MAX_CHECK_COUNT - count} / ${MAX_CHECK_COUNT} 次`);
//           const order = await clobModule.getOrder({
//             orderId: orderID,
//           });
//           if (String(order.status).toUpperCase() != "MATCHED") {
//             logInfo(`订单状态: ${order.status}, 订单信息: ${JSON.stringify(order)}`);
//             if (Number(order.size_matched) > 0) {
//               result = order;
//               continue;
//             }
//           } else {
//             result = order;
//             break;
//           }
//         }
//         if (!result) {
//           logInfo(`超过最大检查次数, 挂单购买失败...`);
//           return null;
//         }
//       }
//     } catch (e) {
//       logInfo(`购买失败...${e}`);
//     }
//     count--;
//   }
//   return result;
// };

// export const limitSell = async ({
//   tokenId,
//   amount,
//   price = 0.01,
//   slugIntervalTimestamp,
// }: {
//   tokenId: string;
//   amount: number;
//   price: number;
//   slugIntervalTimestamp: number;
// }): Promise<PolymarketOrderResult | null> => {
//   let result: PolymarketOrderResult | null = null;
//   const clobModule = getClobModule();
//   let count = 0;
//   while (!result && distanceToNextInterval(slugIntervalTimestamp) > 0) {
//     try {
//       logInfo(`🙏尝试挂单卖出... 第${count++} 次`);
//       const { orderID } = await clobModule.postOrder({
//         tokenID: tokenId,
//         side: Side.SELL,
//         price: price,
//         size: amount,
//         orderType: OrderType.GTC,
//       });
//     } catch (e) {
//       logInfo(`卖出失败...${e}`);
//     }
//     count--;
//   }
//   return result;
// };

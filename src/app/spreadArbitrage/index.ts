import { runIntervalFn } from "@shared/utils/runInterval";

import { getConfig } from "./config";
import { logInfo, logError, setTraceId, customTypeLog, logTrade } from "./logger";
import {
  distanceToNextInterval,
  get15MinIntervalTimestamp,
  getMarketSlug15Min,
} from "@shared/marketUtils";
import gammaApi from "@shared/api/gammaApi";
import { TMarketResponseData } from "@typings/gammaData";
import { getAccountBalanceWithRetry, logAccountBalance } from "./utils/account";
import clobApi from "@shared/api/clobApi";
import dataFlow from "./utils/dataFlow";
import { findChance, watchPosition } from "./strategy";
import { getPriceToBeat } from "./utils/getPriceToBeat";
import { waitFor } from "@crypto15min/utils/tools";
import { WATCH_POSITION_ACTION_ENUM } from "@shared/constants";
// import { buy, mustGetOrder, mustSell } from "./utils/order";
import dataRecord from "./dataRecord";

const main = async () => {
  const config = getConfig();
  await clobApi.init();

  runIntervalFn(async () => {
    const slugIntervalTimestamp = get15MinIntervalTimestamp();
    const marketSlug = getMarketSlug15Min(config.marketTag, slugIntervalTimestamp);
    setTraceId(marketSlug);
    dataRecord.setTraceId(marketSlug);

    let totalProfit = 0;

    try {
      dataRecord.cleanOldData(3);
      logInfo(`获取市场信息: ${marketSlug} ...`);
      const market: TMarketResponseData | null = await gammaApi.getMarketBySlug(marketSlug);
      logInfo(`获取市场信息成功!`);

      logInfo(`初始化数据流 ...`);
      dataFlow.initialize({
        logger: {
          logInfo,
          logError,
          customTypeLog,
        },
        dataRecord,
        symbol: config.marketTag,
      });
      logInfo(`初始化数据流成功!`);

      logInfo(`订阅币安价格 ... ${config.marketTag}/usdc`);
      await dataFlow.getInstances()?.bnPriceWs.connect();
      logInfo(`订阅币安价格成功!`);

      logInfo(`订阅 Polymarket 价格 ... ${config.marketTag}/usd`);
      await dataFlow.getInstances()?.polyPriceWs.connect();
      dataFlow.getInstances()?.polyPriceWs.subscribeCryptoPrices(`${config.marketTag}/usd`);
      logInfo(`订阅 Polymarket 价格成功!`);

      logInfo(`订阅 Polymarket 订单簿 ... ${JSON.parse(market.clobTokenIds)}`);
      await dataFlow.getInstances()?.polyOrderBookWs.connect();
      dataFlow
        .getInstances()
        ?.polyOrderBookWs.subscribeOrderBook(JSON.parse(market.clobTokenIds) as string[]);
      logInfo(`订阅 Polymarket 订单簿成功!`);

      if (Date.now() - slugIntervalTimestamp * 1000 < config.delayToStart) {
        logInfo(`延迟开始策略...`);
        await waitFor(config.delayToStart - (Date.now() - slugIntervalTimestamp * 1000));
        logInfo(`策略执行...`);
      }

      logInfo(`获取对赌价格...`);
      const priceToBeat = await getPriceToBeat(
        config.marketTag,
        market.eventStartTime,
        market.endDate
      );
      logInfo(`获取对赌价格成功: ${priceToBeat}`);

      logInfo(`策略开始...`);
      let buyAccount = 0;
      while (distanceToNextInterval(slugIntervalTimestamp) > 0) {
        logInfo(`获取账户余额 ...`);
        const balance = await getAccountBalanceWithRetry();
        logInfo(`获取账户余额成功: ${balance}`);

        // const buyAmount = Number(
        //   Math.min(Number(balance) * config.buyingAmountFactor, config.maxBuyAmount).toFixed(2)
        // );

        const buyAmount = 2;

        logInfo(`计算购买金额: ${buyAmount}`);

        logInfo(`寻找机会...`);
        const chance = await findChance({
          market,
          priceToBeat,
          slugIntervalTimestamp,
        });
        if (chance) {
          logInfo(`找到机会: ${JSON.stringify(chance)}`);
          logInfo(`本局买入次数: ${buyAccount}`);
          //   const buyResult = await buy(chance.assetId, chance.buyPrice, buyAmount);
          //   if (!buyResult || !buyResult.orderID) {
          //     logInfo(`买入失败`);
          //     // 进入下一次循环
          //     continue;
          //   }
          //   logInfo(`查询买入订单: ${buyResult.orderID}`);
          //   const boughtOrder = await mustGetOrder(
          //     buyResult.orderID,
          //     distanceToNextInterval(slugIntervalTimestamp)
          //   );
          //   if (!boughtOrder) {
          //     logInfo(`买入订单不存在`);
          //     // 进入下一次循环
          //     continue;
          //   }
          //   logInfo(`买入订单: ${JSON.stringify(boughtOrder)}`);
          //   const { original_size, size_matched, price: boughtPrice } = boughtOrder;
          //   // 记录买入信息
          //   logTrade("buy", {
          //     size: Number(size_matched) === 0 ? Number(original_size) : Number(size_matched),
          //     originalSize: Number(original_size),
          //     price: Number(boughtPrice),
          //     originalPrice: chance.buyPrice,
          //     stopProfitPrice: chance.stopProfitPrice,
          //     stopLossPrice: chance.stopLossPrice,
          //   });
          logTrade("buy", {
            size: 1,
            originalSize: 1,
            price: chance.buyPrice,
            originalPrice: chance.buyPrice,
            stopProfitPrice: chance.stopProfitPrice,
            stopLossPrice: chance.stopLossPrice,
          });
          const buyTime = Date.now();
          buyAccount++;

          logInfo(`监听仓位...`);
          const { action, price } = await watchPosition({
            chance,
            slugIntervalTimestamp,
          });
          logInfo(`监听仓位返回结果: ${action}`);

          const holdTime = Date.now() - buyTime;
          if (action === WATCH_POSITION_ACTION_ENUM.sell) {
            // const {
            //   size_matched: boughtSize,
            //   original_size: boughtOriginalSize,
            //   price: boughtPrice,
            // } = boughtOrder;
            // const sellResult = await mustSell(
            //   chance.assetId,
            //   Number(boughtSize) === 0 ? Number(boughtOriginalSize) : Number(boughtSize),
            //   distanceToNextInterval(slugIntervalTimestamp)
            // );
            // if (!sellResult || !sellResult.orderID) {
            //   logInfo(`卖出失败`);
            //   // 进入下一次循环
            //   continue;
            // }
            // logInfo(`查询卖出订单: ${sellResult.orderID}`);
            // const soldOrder = await mustGetOrder(
            //   sellResult.orderID,
            //   distanceToNextInterval(slugIntervalTimestamp)
            // );
            // if (!soldOrder) {
            //   logInfo(`卖出订单不存在`);
            //   // 进入下一次循环
            //   continue;
            // }
            // logInfo(`卖出订单: ${JSON.stringify(soldOrder)}`);
            // const { original_size, size_matched, price: soldPrice } = soldOrder;
            // const soldSize =
            //   Number(size_matched) === 0 ? Number(original_size) : Number(size_matched);
            // const profit =
            //   Number(soldPrice) * Number(soldSize) - Number(boughtPrice) * Number(soldSize);
            // totalProfit += profit;

            // const loggerData = {
            //   size: Number(soldSize),
            //   originalSize: Number(original_size),
            //   price: Number(soldPrice),
            //   originalPrice: price,
            //   profit,
            //   holdTime,
            // };
            // logTrade("sell", loggerData);

            const profit = price - chance.buyPrice;
            totalProfit += profit;
            logTrade("sell", {
              size: 1,
              originalSize: 1,
              price: price,
              originalPrice: price,
              profit,
              holdTime,
            });

            await waitFor(5 * 1000);
            await logAccountBalance();
          } else if (action === WATCH_POSITION_ACTION_ENUM.hold) {
            logInfo("hold", {
              holdTime,
            });
          }
        } else {
          if (buyAccount <= 0) {
            logTrade("skip");
            logInfo(`未找到机会，等待下一轮策略开始...`);
          }
          await waitFor(distanceToNextInterval(slugIntervalTimestamp));
        }
      }
    } catch (error) {
      logInfo(`策略执行失败: ${error}`);
    }
    logTrade("profit", {
      totalProfit,
    });
    dataFlow.destroy();
    dataRecord.close();
  }, 1000);
};

main();

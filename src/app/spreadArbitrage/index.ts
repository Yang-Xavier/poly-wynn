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
import { getAccountBalanceWithRetry } from "./utils/account";
import clobApi from "@shared/api/clobApi";
import dataFlow from "./utils/dataFlow";
import { findChance, watchPosition } from "./strategy";
import { getPriceToBeat } from "./utils/getPriceToBeat";
import { waitFor } from "@crypto15min/utils/tools";
import { WATCH_POSITION_ACTION_ENUM } from "@shared/constants";

const main = async () => {
  const config = getConfig();
  await clobApi.init();

  runIntervalFn(async () => {
    const slugIntervalTimestamp = get15MinIntervalTimestamp();
    const marketSlug = getMarketSlug15Min(config.marketTag, slugIntervalTimestamp);
    setTraceId(marketSlug);

    try {
      if (Date.now() - slugIntervalTimestamp * 1000 < config.delayToStart) {
        logInfo(`延迟开始...`);
        await waitFor(config.delayToStart - (Date.now() - slugIntervalTimestamp * 1000));
        logInfo(`延迟结束...`);
      }

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

        const buyAmount = Number(
          Math.min(Number(balance) * config.buyingAmountFactor, config.maxBuyAmount).toFixed(2)
        );
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
          logTrade("buy", {
            size: buyAmount / chance.buyPrice,
            originalSize: buyAmount / chance.buyPrice,
            price: chance.buyPrice,
            originalPrice: chance.buyPrice,
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
          if (action === WATCH_POSITION_ACTION_ENUM.sellInProfit) {
            logTrade("sell", {
              size: buyAmount / chance.buyPrice,
              originalSize: buyAmount / chance.buyPrice,
              price: price,
              originalPrice: price,
              profit: chance.stopProfitPrice - chance.buyPrice,
              holdTime,
            });
          } else if (action === WATCH_POSITION_ACTION_ENUM.sellInProfit) {
            logTrade("sell", {
              size: buyAmount / chance.buyPrice,
              originalSize: buyAmount / chance.buyPrice,
              price: price,
              originalPrice: price,
              loss: chance.stopLossPrice - chance.buyPrice,
              holdTime,
            });
          } else if (action === WATCH_POSITION_ACTION_ENUM.hold) {
            logInfo("hold", {
              holdTime,
            });
          }
        } else {
          logTrade("skip");
          await waitFor(distanceToNextInterval(slugIntervalTimestamp));
        }
      }
    } catch (error) {
      logError(`策略执行失败: ${error}`);
    }

    dataFlow.destroy();
  }, 1000);
};

main();

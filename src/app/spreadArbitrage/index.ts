import { runIntervalFn } from "@shared/utils/runInterval";

import { getConfig } from "./config";
import { logInfo, logError, setTraceId, customTypeLog } from "./logger";
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

const main = async () => {
  const config = getConfig();
  let restartCount = 0;
  await clobApi.init();

  runIntervalFn(async () => {
    const slugIntervalTimestamp = get15MinIntervalTimestamp();
    const marketSlug = getMarketSlug15Min(config.marketTag, slugIntervalTimestamp);
    setTraceId(marketSlug);

    try {
      restartCount++;
      if (restartCount > 1) {
        logInfo(`本回合策略重启第 ${restartCount} 次 ...`);
      }

      if (Date.now() - slugIntervalTimestamp < config.delayToStart) {
        logInfo(`延迟开始...`);
        await waitFor(config.delayToStart - (Date.now() - slugIntervalTimestamp));
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

      logInfo(`获取账户余额 ...`);
      const balance = await getAccountBalanceWithRetry();
      logInfo(`获取账户余额成功: ${balance}`);

      const buyAmount = Math.min(Number(balance) * config.buyingAmountFactor, config.maxBuyAmount);
      logInfo(`计算购买金额: ${buyAmount}`);

      logInfo(`寻找机会...`);
      const chance = await findChance({
        market,
        priceToBeat,
        slugIntervalTimestamp,
      });
      logInfo(`找到机会: ${JSON.stringify(chance)}`);

      logInfo(`监听仓位...`);
      const sellAction = await watchPosition({
        chance,
        slugIntervalTimestamp,
      });
      logInfo(`监听仓位返回结果: ${sellAction}`);

      logInfo(`等待下一轮策略开始...`);
      await waitFor(distanceToNextInterval(slugIntervalTimestamp));
    } catch (error) {
      logError(`策略执行失败: ${error}`);
    }

    dataFlow.destroy();
  }, 1000);
};

main();

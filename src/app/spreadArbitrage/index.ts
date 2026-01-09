import { runIntervalFn } from "@shared/utils/runInterval";

import { getConfig } from "./config";
import { logInfo, logError, setTraceId, customTypeLog, cleanOldLogs } from "./logger";
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
import { findChance, IChance, watchPosition } from "./strategy";
import { getPriceToBeat } from "./utils/getPriceToBeat";
import { waitFor } from "@crypto15min/utils/tools";
import { WATCH_POSITION_ACTION_ENUM } from "@shared/constants";
import { buyUntilMatched, mustGetOrder, mustSell } from "./utils/order";
import dataRecord from "./dataRecord";
import tradeReport from "./tradeReport";
import { IOrderData } from "@typings/orderData";
import { getUserpostionByMarketAsOrder } from "./utils/getUserPositionAsOrder";

const setAllTraceId = (marketSlug: string) => {
  setTraceId(marketSlug);
  dataRecord.setTraceId(marketSlug);
  tradeReport.setTraceId(marketSlug);
};

const subscribeData = async (market: TMarketResponseData) => {
  const config = getConfig();
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

  logInfo(`订阅币安价格 ... ${config.marketTag}/usdt`);
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

  logInfo(`订阅用户交易 ...`);
  await dataFlow.getInstances()?.userWs.connect();
  dataFlow.getInstances()?.userWs.subscribe();
  logInfo(`订阅用户交易成功!`);
};

const buyOrder = async ({ chance, buyAmount }: { chance: IChance; buyAmount: number }) => {
  const boughtOrder = (await buyUntilMatched(
    chance.assetId,
    chance.buyPrice,
    buyAmount
  )) as IOrderData;
  if (!boughtOrder) {
    logInfo(`买入订单不存在`);
    // 进入下一次循环
    return false;
  }
  logInfo(`买入订单: ${JSON.stringify(boughtOrder)}`);
  const { original_size, size_matched, price: boughtPrice } = boughtOrder;

  // 记录买入信息
  logInfo("buy", {
    size: Number(size_matched) === 0 ? Number(original_size) : Number(size_matched),
    originalSize: Number(original_size),
    price: Number(boughtPrice),
    originalPrice: chance.buyPrice,
    stopProfitPrice: chance.stopProfitPrice,
    stopLossPrice: chance.stopLossPrice,
  });
  tradeReport.addReport("trade", {
    action: "buy",
    timestamp: Date.now(),
    price: chance.buyPrice,
    amount: Number(boughtOrder.size_matched || boughtOrder.original_size),
    outcome: chance.outcome,
  });
  return boughtOrder;
};

const sellOrder = async ({
  boughtOrder,
  slugIntervalTimestamp,
  boughtTime,
}: {
  boughtOrder: IOrderData;
  slugIntervalTimestamp: number;
  boughtTime: number;
}) => {
  const {
    size_matched: boughtSize,
    original_size: boughtOriginalSize,
    price: boughtPrice,
    outcome: boughtOutcome,
    asset_id: boughtAssetId,
  } = boughtOrder;
  const sellResult = await mustSell(
    boughtAssetId,
    Number(boughtSize) === 0 ? Number(boughtOriginalSize) : Number(boughtSize),
    distanceToNextInterval(slugIntervalTimestamp)
  );
  if (!sellResult || !sellResult.orderID) {
    logInfo(`卖出失败`);
    // 进入下一次循环
    return false;
  }
  logInfo(`查询卖出订单: ${sellResult.orderID}`);
  const soldOrder = await mustGetOrder(
    sellResult.orderID,
    distanceToNextInterval(slugIntervalTimestamp)
  );
  if (!soldOrder) {
    logInfo(`卖出订单不存在`);
    // 进入下一次循环
    return false;
  }
  logInfo(`卖出订单: ${JSON.stringify(soldOrder)}`);
  const { original_size, size_matched, price: soldPrice } = soldOrder;
  const soldSize = Number(size_matched) === 0 ? Number(original_size) : Number(size_matched);
  const profit = Number(soldPrice) * Number(soldSize) - Number(boughtPrice) * Number(soldSize);

  const loggerData = {
    size: Number(soldSize),
    originalSize: Number(original_size),
    price: Number(soldPrice),
    originalPrice: soldPrice,
    profit,
    holdTime: Date.now() - boughtTime,
  };
  logInfo("sell", loggerData);

  tradeReport.addReport("trade", {
    action: "sell",
    price: Number(soldPrice),
    amount: Number(soldOrder.size_matched || soldOrder.original_size),
    outcome: boughtOutcome,
    timestamp: Date.now(),
  });
  return true;
};

const clean = async () => {
  logInfo(`销毁数据流...`);
  dataFlow.destroy();
  logInfo(`保存数据...`);
  dataRecord.saveToJson();
  dataRecord.close();

  logInfo(`清理日志/数据记录/交易报告...`);
  cleanOldLogs(2);
  dataRecord.cleanOldData(2);
  tradeReport.cleanOldReports(14);
};

const main = async () => {
  const config = getConfig();
  await clobApi.init();

  runIntervalFn(async () => {
    const slugIntervalTimestamp = get15MinIntervalTimestamp();
    const marketSlug = getMarketSlug15Min(config.marketTag, slugIntervalTimestamp);
    setAllTraceId(marketSlug);

    try {
      logInfo(`获取市场信息: ${marketSlug} ...`);
      const market: TMarketResponseData | null = await gammaApi.getMarketBySlug(marketSlug);
      logInfo(`获取市场信息成功!`);

      await subscribeData(market);

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
        let boughtOrder;
        let boughtTime;

        logInfo(`获取账户余额 ...`);
        const balance = await getAccountBalanceWithRetry();
        logInfo(`获取账户余额成功: ${balance}`);

        const buyAmount = Number(
          Math.min(Number(balance) * config.buyingAmountFactor, config.maxBuyAmount).toFixed(2)
        );
        logInfo(`计算购买金额: ${buyAmount}`);

        logInfo(`查询持仓订单...`);
        [boughtOrder] = await getUserpostionByMarketAsOrder(
          market.conditionId,
          config.funderAddress
        );
        logInfo(`查询持仓订单成功: ${JSON.stringify(boughtOrder)}`);

        if (!boughtOrder) {
          logInfo(`没有持仓订单，等待机会...`);
          const chance = await findChance({
            market,
            priceToBeat,
            slugIntervalTimestamp,
          });
          if (chance) {
            dataRecord.pin();
            logInfo(`找到机会: ${JSON.stringify(chance)}`);
            logInfo(`本局买入次数: ${buyAccount}`);
            boughtOrder = await buyOrder({ chance, buyAmount });
            boughtTime = Date.now();

            if (!boughtOrder) {
              logInfo(`买入失败`);
              // 进入下一次循环
              continue;
            }
            buyAccount++;
          }

          if (boughtOrder) {
            logInfo(`监听仓位...`);
            const { action } = await watchPosition({
              chance,
              slugIntervalTimestamp,
            });
            dataRecord.pin();
            logInfo(`监听仓位返回结果: ${action}`);

            if (action === WATCH_POSITION_ACTION_ENUM.sell) {
              const sellResult = await sellOrder({
                boughtOrder,
                slugIntervalTimestamp,
                boughtTime,
              });
              if (!sellResult) {
                logInfo(`卖出失败`);
                // 进入下一次循环
                continue;
              }
              logInfo(`卖出成功`);
              await waitFor(5 * 1000);
              await logAccountBalance();
            } else if (action === WATCH_POSITION_ACTION_ENUM.hold) {
              logInfo("hold", {
                holdTime: Date.now() - boughtTime,
              });
            }
          }
        } else {
          logInfo(`有持仓订单, 直接卖出...`);
          const sellResult = await sellOrder({
            boughtOrder,
            slugIntervalTimestamp,
            boughtTime: Date.now(),
          });
          if (!sellResult) {
            logInfo(`卖出失败`);
            // 进入下一次循环
            continue;
          }
          logInfo(`卖出成功`);
          await waitFor(5 * 1000);
          await logAccountBalance();
        }
      }

      if (buyAccount <= 0) {
        tradeReport.addReport("result", {
          result: "skipped",
        });
      } else {
        tradeReport.addReport("result", {
          result: tradeReport.calcProfit() > 0 ? "won" : "lost",
        });
      }
    } catch (error) {
      logInfo(`策略执行失败: ${error}`);
    }

    await clean();
  }, 1000);
};

main();

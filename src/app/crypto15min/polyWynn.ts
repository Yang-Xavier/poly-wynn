import gammaApi from "@shared/api/gammaApi";
import dataApi from "@shared/api/dataApi";
import { OUTCOMES_ENUM, TRADE_ACTION_ENUM } from "@shared/constants";
import { PositionInfo } from "@shared/trade/Position";
import {
  distanceToNextInterval,
  getMarketSlug15Min,
  get15MinIntervalTimestamp,
} from "@shared/utils/market";
import { runIntervalFn } from "@shared/utils/runInterval";
import { waitFor } from "@shared/utils/waitFor";
import { getAccountBalance } from "@shared/web3/account";
import { TMarketResponseData } from "@typings/gammaData";

import { startStrategy } from "@crypto15min/utils/strategy";
import { getConfig } from "@crypto15min/utils/config";
import { getPriceToBeat } from "@crypto15min/utils/getPriceToBeat";

import { APP_NAME } from "./constants";
import {
  getLoggerModule,
  logError,
  logInfo,
  setTraceId,
  logData,
  customTypeLog,
} from "./module/logger";
import dataFlow from "./module/dataFlow";
import dataRecord from "./module/dataRecord";
import redeemTaskManager from "./utils/redeemTaskManager";
import { redeemAllPositions } from "./utils/relayerRedeem";

import { getTrader, initTrader } from "./module/traderCtrl";

const setAllTraceId = (marketSlug: string) => {
  setTraceId(marketSlug);
  dataRecord.setTraceId(marketSlug);
};

const getBuyMaxAmount = async () => {
  const config = getConfig();

  const { balance } = await getAccountBalance(
    config.account.funderAddress,
    config.collateralAddress
  );
  const buyMaxAmount = Math.min(
    config.stratgegy.buyingMaxAmount,
    Number(balance) * config.stratgegy.buyingAmountFactor
  );

  return { buyMaxAmount, balance };
};

const connectWsBeforeStrategy = async () => {
  const config = getConfig();
  logInfo(`订阅PolyCrypto价格: ${config.marketTag}/usd`);
  await dataFlow.getInstances()?.polyPriceWs.connect();
  await dataFlow.getInstances()?.polyPriceWs.subscribeCryptoPrices(`${config.marketTag}/usd`);
  logInfo(`订阅BN价格: ${config.marketTag}usdc`);
  await dataFlow.getInstances()?.bnPriceWs.connect();
};

const connectWsOnStrategy = async (market: TMarketResponseData) => {
  const config = getConfig();
  logInfo(`订阅市场订单簿数据: ${market.clobTokenIds}`);
  await dataFlow.getInstances()?.polyOrderBookWs.connect();
  await dataFlow
    .getInstances()
    ?.polyOrderBookWs.subscribeOrderBook(JSON.parse(market.clobTokenIds) as string[]);

  logInfo(`订阅用户交易数据: ${config.account.funderAddress}`);
  await dataFlow.getInstances()?.userWs.connect();
  await dataFlow.getInstances()?.userWs.subscribe();
};

const disconnectAllWs = async () => {
  logInfo(`断开与PolyPriceWs的连接`);
  await dataFlow.getInstances()?.polyPriceWs.disconnect();
  logInfo(`断开与BNPriceWs的连接`);
  await dataFlow.getInstances()?.bnPriceWs.disconnect();
  logInfo(`断开与PolyOrderBookWs的连接`);
  await dataFlow.getInstances()?.polyOrderBookWs.disconnect();
  logInfo(`断开与UserWs的连接`);
  await dataFlow.getInstances()?.userWs.disconnect();
};

const cleanAtEndOfRound = () => {
  logInfo(`销毁数据流...`);
  dataFlow.destroy();
  logInfo(`保存数据...`);
  dataRecord.saveToJson();
  dataRecord.close();

  logInfo(`清理日志/数据记录/交易报告...`);
  getLoggerModule().cleanOldLogs(2);
  dataRecord.cleanOldData(2);
  getTrader().clear();
  getTrader().tradeReport.cleanOldReports(14);
};

const waitToStart = async (slugIntervalTimestamp: number) => {
  const config = getConfig();
  const distance = distanceToNextInterval(slugIntervalTimestamp);
  const waitTime = Math.max(distance - config.stratgegy.startCollectDataBefore, 0);

  if (waitTime > 0) {
    logInfo(`距离开始采集数据还剩: ${waitTime / 1000}s`);
    await waitFor(waitTime);
  }
};

const waitToGetPriceToBeat = async ({
  slugIntervalTimestamp,
  market,
  marketSlug,
}: {
  slugIntervalTimestamp: number;
  market: TMarketResponseData;
  marketSlug: string;
}) => {
  const config = getConfig();
  const waitTimeToGetPriceToBeat =
    distanceToNextInterval(slugIntervalTimestamp) - config.stratgegy.startGetPriceToBeatBefore;

  logInfo(`等待获取对赌价格还剩: ${waitTimeToGetPriceToBeat / 1000}s`);
  await waitFor(waitTimeToGetPriceToBeat > 0 ? waitTimeToGetPriceToBeat : 0);

  logInfo(`获取对赌价格...`);
  const priceToBeat = await getPriceToBeat(config.marketTag, market.eventStartTime, market.endDate);
  logInfo(`对赌价格: ${priceToBeat}, market: ${marketSlug}`);
  return priceToBeat;
};

const getOnlinePosition = async ({ marketSlug }: { marketSlug: string }) => {
  const config = getConfig();
  const onlinePosition = await dataApi.getPositions({
    user: config.account.funderAddress,
    market: [marketSlug],
  });
  if (onlinePosition && onlinePosition.length > 0) {
    const slugPosition = onlinePosition.find((position) => position.slug === marketSlug);
    if (slugPosition) {
      const position: PositionInfo = {
        outcome: onlinePosition[0].outcome as OUTCOMES_ENUM,
        amount: onlinePosition[0].size * onlinePosition[0].avgPrice,
        size: onlinePosition[0].size,
        price: onlinePosition[0].avgPrice,
        totalFee: 0,
      };
      return position;
    }
  }
  return null;
};

const checkResultByPrice = async ({
  roundEndTimestampMs,
  priceToBeat,
}: {
  roundEndTimestampMs: number;
  priceToBeat: number;
}) => {
  const { before, after } = dataFlow
    .getInstances()
    ?.polyPriceWs.getPriceAroundTimestamp(roundEndTimestampMs);

  if (before && after) {
    if (Math.min(before.value, after.value) > priceToBeat) {
      return OUTCOMES_ENUM.Up;
    }
    if (Math.max(before.value, after.value) < priceToBeat) {
      return OUTCOMES_ENUM.Down;
    }
    return null;
  }
  return null;
};

export const runPolyWynn = async () => {
  const config = getConfig();

  runIntervalFn(async () => {
    const slugIntervalTimestamp = get15MinIntervalTimestamp();
    const roundEndTimestampMs = get15MinIntervalTimestamp(1) * 1000;
    const marketSlug = getMarketSlug15Min(config.marketTag, slugIntervalTimestamp);
    try {
      setAllTraceId(marketSlug);

      logInfo(`检查并赎回所有仓位...`);
      await redeemAllPositions({ funderAddress: config.account.funderAddress });

      logInfo(`开始本回合...`);
      logInfo(`初始化Trader....`);
      initTrader({
        appName: process.env.MARKET ? `${APP_NAME}-${process.env.MARKET}` : APP_NAME,
        privKey: config.account.privKey,
        clobCreds: config.account.clobCreds,
        funderAddress: config.account.funderAddress,
        userWs: dataFlow.getInstances()?.userWs,
        roundEndTimestamp: roundEndTimestampMs,
        logInfo: logInfo,
      });
      logInfo(`Trader初始化完成....`);
      getTrader().setTraceId(marketSlug);

      logInfo(`初始化数据流...`);
      dataFlow.initialize({
        logger: {
          logInfo,
          logError,
          logData,
          customTypeLog,
        },
        symbol: config.marketTag,
      });
      logInfo(`数据流初始化完成...`);

      getTrader().setUserWs(dataFlow.getInstances()?.userWs);

      await waitToStart(slugIntervalTimestamp);
      await connectWsBeforeStrategy();

      logInfo(`获取市场数据...`);
      const market = await gammaApi.getMarketBySlug(marketSlug);

      const priceToBeat = await waitToGetPriceToBeat({ slugIntervalTimestamp, market, marketSlug });

      const waitToStartStrategyTime =
        distanceToNextInterval(slugIntervalTimestamp) - config.stratgegy.startStrategyBefore;

      if (waitToStartStrategyTime > 0) {
        logInfo(`距离开始策略还剩: ${waitToStartStrategyTime / 1000}s`);
        await waitFor(waitToStartStrategyTime);
      }

      logInfo(`==========策略开始==========`);

      let retryCount = 0;
      while (distanceToNextInterval(slugIntervalTimestamp) > 0 && retryCount < 3) {
        try {
          if (retryCount > 0) {
            logInfo(`重试第${retryCount}次...`);
          }

          logInfo(`获取在线仓位...`);
          const onlinePosition = await getOnlinePosition({ marketSlug });
          if (onlinePosition) {
            logInfo(`已有仓位, 加载中: ${JSON.stringify(onlinePosition)}`);
            getTrader().position.setPosition(onlinePosition);
          }

          logInfo(`获取账户余额, 购买金额...`);
          const { buyMaxAmount, balance } = await getBuyMaxAmount();
          logInfo(`💰账户余额: ${balance}, 购买金额: ${buyMaxAmount}`);
          getTrader().tradeReport.addReport("balance", {
            balance: Number(balance),
          });

          if (Number(buyMaxAmount) <= 1) {
            logInfo(`账户余额小于1, 跳过本局购买,等待下一轮开始...`);
            await waitFor(distanceToNextInterval(slugIntervalTimestamp));
            return;
          } else {
            getTrader().setMaxTradeAmount(buyMaxAmount);

            await connectWsOnStrategy(market);

            logInfo(`开始执行策略...`);
            await startStrategy({ market, priceToBeat, slugIntervalTimestamp });
          }
        } catch (e) {
          logError(`本回合策略执行失败,重启中: ${e}`);
          getTrader().tradeReport.addReport("result", {
            result: "error",
          });
          retryCount++;
        }
      }

      logInfo(`==========本回合结束(等待5s后开始验证)==========`);
      await waitFor(distanceToNextInterval(slugIntervalTimestamp));
      await waitFor(5 * 1000); // 等待5秒，让数据流有时间记录数据
      logInfo(`断开与所有WebSocket的连接...`);
      await disconnectAllWs();

      // 获取持有仓位
      const positionCtrl = getTrader().position;
      const positionInfo = positionCtrl.getPosition();
      const trades = positionCtrl.getTrades();
      const isSold = Boolean(trades?.find((trade) => trade.action === TRADE_ACTION_ENUM.sell));
      logInfo(`持有仓位: ${JSON.stringify(positionInfo)}`);

      if (positionInfo.outcome === undefined) {
        logInfo(`🈚️本局没有机会，持仓为空....`);
        getTrader().tradeReport.addReport("result", {
          result: "skipped",
          additionalInfo: "",
        });
      } else if (isSold) {
        logInfo(`👿本局有卖出记录....`);
        getTrader().tradeReport.addReport("result", {
          result: "sold",
          additionalInfo: "",
        });
        redeemTaskManager.addTask(marketSlug, market.conditionId, positionInfo.outcome, true);
      } else if (positionInfo.size > config.stratgegy.sellMinimumSize) {
        logInfo(`根据价格自检最终结果...`);
        const finalOutcome = await checkResultByPrice({ roundEndTimestampMs, priceToBeat });
        if (finalOutcome) {
          const result = positionInfo.outcome === finalOutcome ? "won" : "lost";
          logInfo(
            `最终结果: ${result === "won" ? "🥳Won" : "🤕Lost"}, finalOutcome: ${finalOutcome}`
          );

          getTrader().tradeReport.addReport("result", {
            result,
            additionalInfo: "等待最终验证",
          });
        } else {
          logInfo(`自检结果存在争议: 等待最终验证`);
          getTrader().tradeReport.addReport("result", {
            result: "waiting...",
            additionalInfo: "自检结果存在争议",
          });
        }
        redeemTaskManager.addTask(marketSlug, market.conditionId, positionInfo.outcome, false);
      }

      if (redeemTaskManager.getTaskCount() >= 1) {
        logInfo(`等待赎回仓位...${config.redeemConfig.delyRedeem / 1000}s`);
        await waitFor(config.redeemConfig.delyRedeem);

        logInfo(`检查价格和最终结果...`);
        await redeemTaskManager.runCheckResultAndRedeem();
      }

      const { balance } = await getAccountBalance(
        config.account.funderAddress,
        config.collateralAddress
      );

      logInfo(`👋本局结束...`);
      logInfo(`💰账户余额: ${balance}`);
      getTrader().tradeReport.addReport("balance", {
        balance: Number(balance),
      });
    } catch (e) {
      logInfo(`策略执行失败: ${e}`);
      getTrader().tradeReport.addReport("result", {
        result: "error",
      });
    }

    cleanAtEndOfRound();
    await waitFor(1000);
  });
};

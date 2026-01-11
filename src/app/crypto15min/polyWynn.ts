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
import { destroyDataFlow, getDataFlowInstances, initializeDataFlow } from "./module/dataFlow";
import dataRecord from "./module/dataRecord";
import redeemTaskManager from "./utils/redeemTaskManager";
import { redeemAllPositions } from "./utils/relayerRedeem";

import { getTrader, initTrader } from "./module/Trader";

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
  await getDataFlowInstances()?.polyPriceWs.connect();
  await getDataFlowInstances()?.polyPriceWs.subscribeCryptoPrices(`${config.marketTag}/usd`);
  logInfo(`订阅BN价格: ${config.marketTag}usdc`);
  await getDataFlowInstances()?.bnPriceWs.connect();
};

const connectWsOnStrategy = async (market: TMarketResponseData) => {
  const config = getConfig();
  logInfo(`订阅市场订单簿数据: ${market.clobTokenIds}`);
  await getDataFlowInstances()?.polyOrderBookWs.connect();
  await getDataFlowInstances()?.polyOrderBookWs.subscribeOrderBook(
    JSON.parse(market.clobTokenIds) as string[]
  );

  logInfo(`订阅用户交易数据: ${config.account.funderAddress}`);
  await getDataFlowInstances()?.userWs.connect();
  await getDataFlowInstances()?.userWs.subscribe();
};

const disconnectAllWs = async () => {
  logInfo(`断开与PolyPriceWs的连接`);
  await getDataFlowInstances()?.polyPriceWs.disconnect();
  logInfo(`断开与BNPriceWs的连接`);
  await getDataFlowInstances()?.bnPriceWs.disconnect();
  logInfo(`断开与PolyOrderBookWs的连接`);
  await getDataFlowInstances()?.polyOrderBookWs.disconnect();
  logInfo(`断开与UserWs的连接`);
  await getDataFlowInstances()?.userWs.disconnect();
};

const cleanAtEndOfRound = () => {
  logInfo(`销毁数据流...`);
  destroyDataFlow();
  logInfo(`保存数据...`);
  dataRecord.saveToJson();
  dataRecord.close();

  logInfo(`清理日志/数据记录/交易报告...`);
  getLoggerModule().cleanOldLogs(2);
  dataRecord.cleanOldData(2);
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
    const position: PositionInfo = {
      outcome: onlinePosition[0].outcome as OUTCOMES_ENUM,
      amount: onlinePosition[0].size * onlinePosition[0].avgPrice,
      size: onlinePosition[0].size,
      price: onlinePosition[0].avgPrice,
      totalFee: 0,
    };
    return position;
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

      logInfo(`开始本回合...`);
      logInfo(`初始化Trader....`);
      initTrader({
        appName: process.env.MARKET ? `${APP_NAME}-${process.env.MARKET}` : APP_NAME,
        privKey: config.account.privKey,
        clobCreds: config.account.clobCreds,
        funderAddress: config.account.funderAddress,
        userWs: getDataFlowInstances()?.userWs,
        roundEndTimestamp: roundEndTimestampMs,
        logInfo: logInfo,
      });
      logInfo(`Trader初始化完成....`);
      getTrader().setTraceId(marketSlug);

      logInfo(`检查并赎回所有仓位...`);
      await redeemAllPositions({ funderAddress: config.account.funderAddress });

      logInfo(`初始化数据流...`);
      initializeDataFlow({
        logger: {
          logInfo,
          logError,
          logData,
          customTypeLog,
        },
        symbol: config.marketTag,
      });
      logInfo(`数据流初始化完成...`);

      getTrader().setUserWs(getDataFlowInstances()?.userWs);

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

      await waitFor(distanceToNextInterval(slugIntervalTimestamp));
      await waitFor(5 * 1000); // 等待5秒，让数据流有时间记录数据
      await disconnectAllWs();

      // 获取持有仓位
      const position = getTrader().position.getPosition();
      // 如果持有仓位，则检查价格和最终结果
      if (position.amount > 1) {
        redeemTaskManager.addTask(marketSlug, market.conditionId, position.outcome);
      } else if (position.outcome === undefined) {
        logInfo(`🈚️本局没有机会没有仓位....`);
        getTrader().tradeReport.addReport("result", {
          result: "skipped",
        });
      }

      if (
        getTrader()
          .position.getTrades()
          .find((trade) => trade.action === TRADE_ACTION_ENUM.sell)
      ) {
        logInfo(`本局有卖出记录....`);
        getTrader().tradeReport.addReport("result", {
          result: "sold",
        });
      }

      if (redeemTaskManager.getTaskCount() === 1) {
        logInfo(`等待赎回仓位...${config.redeemConfig.delyRedeem / 1000}s`);
        await waitFor(config.redeemConfig.delyRedeem);

        logInfo(`检查价格和最终结果...`);
        await redeemTaskManager.runRedeem();
      }
      const { balance } = await getAccountBalance(
        config.account.funderAddress,
        config.collateralAddress
      );

      logInfo(`本局结束...`);
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
  });
};

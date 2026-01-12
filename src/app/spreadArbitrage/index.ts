import { runIntervalFn } from "@shared/utils/runInterval";

import { getConfig } from "./config";
import { logInfo, logError, setTraceId, customTypeLog, cleanOldLogs } from "./logger";
import {
  distanceToNextInterval,
  get15MinIntervalTimestamp,
  getMarketSlug15Min,
  getTokenIdFromMarketByOutcome,
} from "@shared/utils/market";
import gammaApi from "@shared/api/gammaApi";
import { TMarketResponseData } from "@typings/gammaData";

import dataFlow from "./utils/dataFlow";
import { startStrategy } from "./strategy";
import { getPriceToBeat } from "./utils/getPriceToBeat";
import { waitFor } from "@shared/utils/waitFor";
import { OUTCOMES_ENUM, TRADE_ACTION_ENUM, USDC_ADDRESS } from "@shared/constants";

import dataRecord from "./dataRecord";

import { getTrader, initTrader } from "./traderCtrl";
import { APP_NAME } from "./constants";
import { getAccountBalance } from "@shared/web3/account";
import dataApi from "@shared/api/dataApi";
import { PositionInfo } from "@shared/trade/Position";

const setAllTraceId = (marketSlug: string) => {
  setTraceId(marketSlug);
  dataRecord.setTraceId(marketSlug);
};

const init = ({ roundEndTimestampMs }: { roundEndTimestampMs: number }) => {
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
  logInfo(`初始化交易器 ...`);
  initTrader({
    appName: APP_NAME,
    privKey: config.account.privKey,
    clobCreds: config.account.clobCreds,
    funderAddress: config.account.funderAddress,
    userWs: dataFlow.getInstances()?.userWs,
    roundEndTimestamp: roundEndTimestampMs,
    logInfo: logInfo,
  });
  logInfo(`初始化交易器成功!`);
};

const subscribeData = async (market: TMarketResponseData) => {
  const config = getConfig();

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

const getBuyMaxAmount = async () => {
  const config = getConfig();
  const { balance } = await getAccountBalance(config.account.funderAddress, USDC_ADDRESS);

  return {
    buyMaxAmount: Math.min(Number(balance) * config.buyingAmountFactor, config.maxBuyAmount),
    balance: Number(balance),
  };
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

const clean = async () => {
  logInfo(`销毁数据流...`);
  dataFlow.destroy();
  logInfo(`保存数据...`);
  dataRecord.saveToJson();
  dataRecord.close();

  logInfo(`清理日志/数据记录/交易报告...`);
  cleanOldLogs(2);
  dataRecord.cleanOldData(2);
  getTrader().clear();
};

const main = async () => {
  const config = getConfig();

  runIntervalFn(async () => {
    const slugIntervalTimestamp = get15MinIntervalTimestamp();
    const roundEndTimestampMs = get15MinIntervalTimestamp(1) * 1000;
    const marketSlug = getMarketSlug15Min(config.marketTag, slugIntervalTimestamp);
    setAllTraceId(marketSlug);
    init({ roundEndTimestampMs });

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

      while (distanceToNextInterval(slugIntervalTimestamp) > 0) {
        logInfo(`获取账户余额 ...`);
        const { balance, buyMaxAmount } = await getBuyMaxAmount();
        logInfo(`获取账户余额成功: ${balance}, 购买金额: ${buyMaxAmount}`);
        getTrader().tradeReport.addReport("balance", {
          balance: Number(balance),
        });

        getTrader().setMaxTradeAmount(buyMaxAmount);

        logInfo(`查询持仓订单...`);
        const onlinePosition = await getOnlinePosition({ marketSlug });

        if (onlinePosition) {
          logInfo(`查询持仓订单成功: ${JSON.stringify(onlinePosition)}`);
          logInfo(`有持仓订单, 直接卖出...`);
          getTrader().position.setPosition(onlinePosition);
          getTrader().tradeTaskManage.addTask({
            tokenId: getTokenIdFromMarketByOutcome(market, onlinePosition.outcome),
            action: TRADE_ACTION_ENUM.sell,
            price: onlinePosition.price,
            outcome: onlinePosition.outcome,
          });
        } else {
          logInfo(`没有持仓订单，等待机会...`);
        }

        logInfo(`开始策略...`);
        await startStrategy({ market, priceToBeat, slugIntervalTimestamp });

        logInfo("====================本局结束=====================");
      }

      const trades = getTrader().position.getTrades();
      const buyCount = trades.filter((trade) => trade.action === TRADE_ACTION_ENUM.buy).length;
      const sellCount = trades.filter((trade) => trade.action === TRADE_ACTION_ENUM.sell).length;

      if (Math.max(buyCount, sellCount) <= 0) {
        logInfo(`没有买入订单，跳过...`);
        getTrader().tradeReport.addReport("result", {
          result: "skipped",
        });
      } else {
        logInfo(`有交易订单，计算收益...`);
        const buyTrades = trades.filter((trade) => trade.action === TRADE_ACTION_ENUM.buy);
        const sellTrades = trades.filter((trade) => trade.action === TRADE_ACTION_ENUM.sell);
        const buyPrice = buyTrades[0].price;
        const sellPrice = sellTrades[0].price;
        const profit = sellPrice - buyPrice;
        logInfo(`收益: ${profit}`);
        getTrader().tradeReport.addReport("result", {
          result: profit > 0 ? "won" : "lost",
        });
      }
    } catch (error) {
      logInfo(`策略执行失败: ${error}`);
    }

    await clean();
  }, 1000);
};

main();

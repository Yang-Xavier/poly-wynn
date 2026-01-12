import { distanceToNextInterval, getTokenIdFromMarketByOutcome } from "@shared/utils/market";
import { TMarketResponseData } from "@typings/gammaData";
import dataFlow from "./utils/dataFlow";
import { getConfig } from "./config";
import { calculateProbabilityBasedOnBSM } from "@shared/algorithm/bsm";
import { logInfo, logStrategy } from "./logger";
import { OUTCOMES_ENUM, TRADE_ACTION_ENUM } from "@shared/constants";
import { predictSpreadChange } from "@shared/algorithm/spreadPredictor";
import { calculateStopLoss } from "./calc";
import { getTrader } from "./traderCtrl";
import { waitFor } from "@shared/utils/waitFor";

export interface IChance {
  assetId: string;
  outcome: OUTCOMES_ENUM;
  buyPrice: number;
  stopProfitPrice: number;
  stopLossPrice: number;
}

let chance: IChance | null = null;

const findingChance = async (params: {
  market: TMarketResponseData;
  priceToBeat: number;
  slugIntervalTimestamp: number;
}) => {
  const { market, priceToBeat, slugIntervalTimestamp } = params;
  const tokenIds = {
    [OUTCOMES_ENUM.Up]: getTokenIdFromMarketByOutcome(market, OUTCOMES_ENUM.Up),
    [OUTCOMES_ENUM.Down]: getTokenIdFromMarketByOutcome(market, OUTCOMES_ENUM.Down),
  };
  const dataFlowInstances = dataFlow.getInstances();
  const config = getConfig();

  const shouldFinding = () => {
    const trades = getTrader().position.getTrades();
    const buyCount = trades.filter((trade) => trade.action === TRADE_ACTION_ENUM.buy).length;

    return (
      distanceToNextInterval(slugIntervalTimestamp) > 0 &&
      getTrader().tradeTaskManage.getRunningTaskAction() === null &&
      getTrader().getRemainAmount() >= config.minBuyAmount &&
      buyCount < config.maxBuyCount
    );
  };

  let predictPriceHistory = [];
  dataFlowInstances.polyPriceWs.onPriceChange(() => {
    if (!shouldFinding()) return;
    predictPriceHistory = [...dataFlowInstances.polyPriceWs.getPriceHistory()];
  });

  dataFlowInstances.bnPriceWs.onPriceChange((bnPrice) => {
    if (!shouldFinding()) return;

    const polyPrice = dataFlowInstances.polyPriceWs.getLatestPriceData();
    const upOrderbook = dataFlowInstances.polyOrderBookWs.getLatestOrderBookData(
      tokenIds[OUTCOMES_ENUM.Up]
    );
    const downOrderbook = dataFlowInstances.polyOrderBookWs.getLatestOrderBookData(
      tokenIds[OUTCOMES_ENUM.Down]
    );

    const upBestAsk = upOrderbook[tokenIds[OUTCOMES_ENUM.Up]]?.bestAsk ?? 0;
    const downBestAsk = downOrderbook[tokenIds[OUTCOMES_ENUM.Down]]?.bestAsk ?? 0;

    const bnPriceHistory = dataFlowInstances.bnPriceWs.getPriceHistory();

    if (!polyPrice) {
      logInfo(`没有获取到价格`);
      return;
    }
    if (!upOrderbook || !downOrderbook) {
      logInfo(`没有获取到订单簿数据`);
      return;
    }
    if (upBestAsk === 0 || downBestAsk === 0) {
      logInfo(
        `upBestAsk: ${JSON.stringify(upOrderbook)}, downBestAsk: ${JSON.stringify(downOrderbook)}`
      );
      logInfo(`没有获取到最佳报价`);
      return;
    }

    if (
      Math.min(bnPriceHistory.length, predictPriceHistory.length) > config.startCalcMinDataPoints
    ) {
      // 预测价格
      const { predictedNewPrice } = predictSpreadChange(
        bnPriceHistory,
        predictPriceHistory,
        bnPrice.value,
        polyPrice.value
      );

      predictPriceHistory.push({
        value: predictedNewPrice,
        timestamp: Date.now(),
      });

      const bsmResult = calculateProbabilityBasedOnBSM(
        predictPriceHistory,
        priceToBeat,
        distanceToNextInterval(slugIntervalTimestamp)
      );
      if (
        Math.max(bsmResult.probUp - Number(upBestAsk), bsmResult.probDown - Number(downBestAsk)) >
        config.bsmProbThreshold
      ) {
        // up或者down 大于阈值，则认为有机会

        const outcome =
          bsmResult.probUp - Number(upBestAsk) > bsmResult.probDown - Number(downBestAsk)
            ? OUTCOMES_ENUM.Up
            : OUTCOMES_ENUM.Down;

        const buyPrice = outcome === OUTCOMES_ENUM.Up ? upBestAsk : downBestAsk;

        const probAdvantage =
          outcome === OUTCOMES_ENUM.Up
            ? bsmResult.probUp - Number(upBestAsk)
            : bsmResult.probDown - Number(downBestAsk);

        const stopProfitPrice = Number(
          (probAdvantage * config.stopProfitFactor + Number(buyPrice)).toFixed(2)
        );

        // 计算科学的止损点
        const stopLossPrice = calculateStopLoss({
          bsmProbability: outcome === OUTCOMES_ENUM.Up ? bsmResult.probUp : bsmResult.probDown,
          confidence: bsmResult.confidence,
          timeToExpiryMs: distanceToNextInterval(slugIntervalTimestamp),
          buyPrice,
          probAdvantage,
          outcome,
        });

        chance = {
          assetId: tokenIds[outcome],
          outcome,
          buyPrice,
          stopProfitPrice,
          stopLossPrice,
        };
        logStrategy(
          `=== 💡找到机会 ===
          ${JSON.stringify({
            predictedNewPrice,
            curentPrice: polyPrice.value,
            priceToBeat,
            upBestAsk,
            downBestAsk,
            bsmResult,
            chance: chance,
            calcCost: `${Date.now() - bnPrice.receivedAt}ms`,
          })}
          `
        );
        getTrader().tradeTaskManage.addTask({
          tokenId: tokenIds[chance.outcome],
          action: TRADE_ACTION_ENUM.buy,
          price: chance.buyPrice,
          outcome: chance.outcome,
          amount: getTrader().getRemainAmount(),
        });
      } else {
        logStrategy(`=== 未找到机会 ===
          ${JSON.stringify({
            predictedNewPrice,
            curentPrice: polyPrice.value,
            priceToBeat,
            upBestAsk,
            downBestAsk,
            bsmResult,
            calcCost: `${Date.now() - bnPrice.receivedAt}ms`,
          })}
        `);
      }
    }
  });
};

const watchingPosition = async (params: {
  market: TMarketResponseData;
  slugIntervalTimestamp: number;
}) => {
  const { market, slugIntervalTimestamp } = params;
  const dataFlowInstances = dataFlow.getInstances();
  const config = getConfig();

  const shouldWatching = () => {
    const position = getTrader().position.getPosition();
    return (
      distanceToNextInterval(slugIntervalTimestamp) > 0 &&
      position.size > config.minSellSize &&
      getTrader().tradeTaskManage.getRunningTaskAction() === null
    );
  };
  dataFlowInstances.polyOrderBookWs.onOrderBookChange((orderBook) => {
    if (!shouldWatching()) return;
    const position = getTrader().position.getPosition();
    const tokenId = getTokenIdFromMarketByOutcome(market, position.outcome);

    const { stopProfitPrice, stopLossPrice } = chance;
    const bestBid = orderBook[tokenId]?.bestBid;

    if (bestBid && (Number(bestBid) <= stopLossPrice || Number(bestBid) >= stopProfitPrice)) {
      logStrategy(`=== 💡卖出 ===
        ${JSON.stringify({
          bestBid,
          stopLossPrice,
          stopProfitPrice,
          position,
        })}
      `);
      getTrader().tradeTaskManage.addTask({
        tokenId: tokenId,
        action: TRADE_ACTION_ENUM.sell,
        price: bestBid,
        outcome: position.outcome,
        size: position.size,
      });
    }
  });
};

export const startStrategy = async (params: {
  market: TMarketResponseData;
  priceToBeat: number;
  slugIntervalTimestamp: number;
}) => {
  const { market, slugIntervalTimestamp, priceToBeat } = params;
  findingChance({ market, priceToBeat, slugIntervalTimestamp });
  watchingPosition({ market, slugIntervalTimestamp });

  await waitFor(distanceToNextInterval(slugIntervalTimestamp));
};

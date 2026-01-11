import { calcAttenuation } from "@shared/algorithm/calcAttenuation";
import { PriceData } from "@shared/ws/BnPriceWs";
import { predictSpreadChange } from "@shared/algorithm/spreadPredictor";
import { TRADE_ACTION_ENUM } from "@shared/constants";
import { TMarketResponseData } from "@typings/gammaData";
import { waitFor } from "@shared/utils/waitFor";
import { distanceToNextInterval } from "@shared/utils/market";

import { logInfo, logStrategy } from "@crypto15min/module/logger";
import { getDataFlowInstances } from "@crypto15min/module/dataFlow";
import { getTrader } from "@crypto15min/module/Trader";

import { getConfig } from "./config";
import { OUTCOMES_ENUM } from "@shared/constants";
import { decision } from "./decision";

const getOutcomeByAssetId = (market: TMarketResponseData, assetId: string) => {
  const { clobTokenIds, outcomes } = market;
  const tokenIds = JSON.parse(clobTokenIds) as string[];
  const index = tokenIds.findIndex((id) => id === assetId);
  return JSON.parse(outcomes)[index] as string;
};

const getAssetIdToOutcomeMap = (market: TMarketResponseData) => {
  const outcomes: { [key in OUTCOMES_ENUM]: string } = {
    [OUTCOMES_ENUM.Up]: "",
    [OUTCOMES_ENUM.Down]: "",
  };
  const tokenIds = JSON.parse(market.clobTokenIds) as string[];
  tokenIds.forEach((id) => {
    outcomes[getOutcomeByAssetId(market, id)] = id;
  });
  return outcomes;
};

const getOrderBookOfOutcomes = (outcomes: { [key in OUTCOMES_ENUM]: string }) => {
  return {
    [OUTCOMES_ENUM.Up]: getDataFlowInstances()?.polyOrderBookWs.getLatestOrderBookData(
      outcomes[OUTCOMES_ENUM.Up]
    )?.[outcomes[OUTCOMES_ENUM.Up]] ?? {
      bestAsk: 0,
      bestBid: 0,
      asksVolume: 0,
      bidsVolume: 0,
      receivedAt: 0,
    },
    [OUTCOMES_ENUM.Down]: getDataFlowInstances()?.polyOrderBookWs.getLatestOrderBookData(
      outcomes[OUTCOMES_ENUM.Down]
    )?.[outcomes[OUTCOMES_ENUM.Down]] ?? {
      bestAsk: 0,
      bestBid: 0,
      asksVolume: 0,
      bidsVolume: 0,
      receivedAt: 0,
    },
  };
};

const findingChanceAndBuying = ({
  market,
  priceToBeat,
  slugIntervalTimestamp,
}: {
  market: TMarketResponseData;
  priceToBeat: number;
  slugIntervalTimestamp: number;
}) => {
  const config = getConfig();
  const outcomes = getAssetIdToOutcomeMap(market);

  logInfo(`[findChance] outcomes: ${JSON.stringify(outcomes)}`);

  let skipped = false;

  try {
    getDataFlowInstances()?.polyOrderBookWs.onOrderBookChange(() => {
      if (skipped) {
        return;
      }
      if (distanceToNextInterval(slugIntervalTimestamp) <= 0) {
        skipped = true;
        logStrategy("本局结束, 跳过策略执行...");
        return;
      }
      const maxTradeAmount = getTrader().getMaxTradeAmount();
      const currentPosition = getTrader().position.getPosition();
      if (currentPosition.amount >= maxTradeAmount) {
        skipped = true;
        logStrategy(`当前持仓量已达到最大持仓量, 跳过买入...`);
        return;
      }
      const isRunningTradeTask =
        getTrader().tradeTaskManage.getRunningTaskAction() === TRADE_ACTION_ENUM.buy;

      if (isRunningTradeTask) {
        logStrategy(`当前有交易任务正在执行, 跳过策略执行...`);
        return;
      }

      const orderBookOfOutcomes = getOrderBookOfOutcomes(outcomes);
      if (
        Math.min(
          orderBookOfOutcomes[OUTCOMES_ENUM.Up].bestAsk,
          orderBookOfOutcomes[OUTCOMES_ENUM.Down].bestAsk
        ) <= 0 && // 没有订单可成交
        Math.max(
          orderBookOfOutcomes[OUTCOMES_ENUM.Up].bestAsk,
          orderBookOfOutcomes[OUTCOMES_ENUM.Down].bestAsk
        ) < config.stratgegy.buyBestAskThreshold // 小于成交阈值
      ) {
        logStrategy(
          `[🤔Hold][🧐findingChanceAndBuying][polyOrderBookWs.onOrderBookChange] 没有订单可成交, 跳过买入...`
        );
        return;
      }

      const historyPriceList = getDataFlowInstances()?.polyPriceWs.getPriceHistory();
      const currentPrice = getDataFlowInstances()?.polyPriceWs.getLatestPriceData();

      const acceptableWinProbability = calcAttenuation(
        [
          [...config.stratgegy.buyAcceptableWinProbabilityRange].sort((a, b) => a - b), // 从小到大
          [config.stratgegy.startStrategyBefore, 0].sort((a, b) => a - b), // 从小到大
        ],
        distanceToNextInterval(slugIntervalTimestamp),
        2,
        0.8
      );

      const decisionResult = decision(
        historyPriceList,
        priceToBeat,
        distanceToNextInterval(slugIntervalTimestamp)
      );

      if (
        decisionResult.winProbability > acceptableWinProbability && // 胜率高于阈值
        orderBookOfOutcomes[decisionResult.side].bestAsk >= config.stratgegy.buyBestAskThreshold && // 订单簿BestAsk 高于阈值
        orderBookOfOutcomes[decisionResult.side].bestAsk <= 0.99 // 有订单
      ) {
        const bestAsk = Number(orderBookOfOutcomes[decisionResult.side].bestAsk.toFixed(2));
        const asksVolume = orderBookOfOutcomes[decisionResult.side].asksVolume;

        const buyAmount = Math.min(
          asksVolume * config.stratgegy.buyMaxVolumeThreshold,
          maxTradeAmount
        );

        getTrader().tradeTaskManage.addTask({
          tokenId: outcomes[decisionResult.side],
          action: TRADE_ACTION_ENUM.buy,
          price: bestAsk,
          amount: buyAmount,
          outcome: decisionResult.side,
        });

        logStrategy(
          `[✅Buy][🧐findingChanceAndBuying][polyOrderBookWs.onOrderBookChange]
          ${JSON.stringify({
            side: decisionResult.side,
            acceptableWinProbability,
            winProbability: decisionResult.winProbability,
            confidence: decisionResult.confidence,
            bestAsk: orderBookOfOutcomes[decisionResult.side].bestAsk,
            priceToBeat,
            currentPrice: currentPrice?.value,
            asksVolume: orderBookOfOutcomes[decisionResult.side].asksVolume,
            probabilityBasedOnGBM: decisionResult.probabilityBasedOnGBM,
            probabilityBasedOnBSM: decisionResult.probabilityBasedOnBSM,
            cost: Date.now() - orderBookOfOutcomes[decisionResult.side].receivedAt,
          })}
          `
        );
      } else {
        logStrategy(
          `[⏩Wait][🧐findingChanceAndBuying][polyOrderBookWs.onOrderBookChange]
          ${JSON.stringify({
            side: decisionResult.side,
            acceptableWinProbability,
            winProbability: decisionResult.winProbability,
            confidence: decisionResult.confidence,
            bestAsk: orderBookOfOutcomes[decisionResult.side].bestAsk,
            priceToBeat,
            currentPrice: currentPrice?.value,
            asksVolume: orderBookOfOutcomes[decisionResult.side].asksVolume,
            probabilityBasedOnGBM: decisionResult.probabilityBasedOnGBM,
            probabilityBasedOnBSM: decisionResult.probabilityBasedOnBSM,
            cost: Date.now() - orderBookOfOutcomes[decisionResult.side].receivedAt,
          })}
          `
        );
      }
    });
  } catch (e) {
    logInfo(`findChanceByWatchPrice failed! ${e}`);
  }
};

const watchingPosition = ({
  market,
  priceToBeat,
  slugIntervalTimestamp,
}: {
  market: TMarketResponseData;
  priceToBeat: number;
  slugIntervalTimestamp: number;
}) => {
  const config = getConfig();
  const outcomes = getAssetIdToOutcomeMap(market);

  let predictPriceHistory: PriceData[] = [];
  let skipped = false;

  const getPositionToWatch = () => {
    if (skipped) {
      return;
    }
    if (distanceToNextInterval(slugIntervalTimestamp) <= 0) {
      skipped = true;
      return;
    }
    const currentPosition = getTrader().position.getPosition();
    if (currentPosition.size < 1 || !currentPosition.outcome) {
      return;
    }
    return currentPosition;
  };

  getDataFlowInstances()?.polyPriceWs.onPriceChange((polyPrice: PriceData) => {
    const position = getPositionToWatch();
    if (!position) {
      return;
    }

    const polHitoryPrice = getDataFlowInstances()?.polyPriceWs.getPriceHistory();
    predictPriceHistory = [...polHitoryPrice];

    const decisionResult = decision(
      polHitoryPrice,
      priceToBeat,
      distanceToNextInterval(slugIntervalTimestamp)
    );

    const winProbability =
      decisionResult.side === position.outcome
        ? decisionResult.winProbability
        : 1 - decisionResult.winProbability;
    const orderBook = getOrderBookOfOutcomes(outcomes);

    const bestBid = orderBook[position.outcome]?.bestBid;
    const currentSide = polyPrice.value > priceToBeat ? OUTCOMES_ENUM.Up : OUTCOMES_ENUM.Down;

    if (
      winProbability < config.stratgegy.sellPredictProbabilityThreshold &&
      decisionResult.side != position.outcome &&
      bestBid < config.stratgegy.sellProbabilityThreshold &&
      currentSide != position.outcome
    ) {
      getTrader().tradeTaskManage.addTask({
        tokenId: outcomes[position.outcome],
        action: TRADE_ACTION_ENUM.sell,
        price: bestBid,
        size: position.size,
        outcome: position.outcome,
      });
      logStrategy(
        `[❗️Sell][🙏watchingPosition][😈polyPriceWs.onPriceChange] 预测价格胜率, 都概率低于阈值, 当前价格与买入方向不一致
        ${JSON.stringify({
          outcome: position.outcome,
          bestBid: bestBid,
          predictSide: decisionResult.side,
          predictWinProbability: decisionResult.winProbability,
          polyPrice: polyPrice.value,
          priceToBeat: priceToBeat,
          currentSide: currentSide,
          probabilityBasedOnGBM: decisionResult.probabilityBasedOnGBM,
          probabilityBasedOnBSM: decisionResult.probabilityBasedOnBSM,
          cost: Date.now() - polyPrice.receivedAt,
        })}
        `
      );
    } else {
      logStrategy(
        `[🤔Hold][🙏watchingPosition][😈polyPriceWs.onPriceChange]
        ${JSON.stringify({
          outcome: position.outcome,
          bestBid: bestBid,
          predictSide: decisionResult.side,
          predictWinProbability: decisionResult.winProbability,
          polyPrice: polyPrice.value,
          priceToBeat: priceToBeat,
          currentSide: currentSide,
          cost: Date.now() - polyPrice.receivedAt,
        })}
        `
      );
    }
  });

  getDataFlowInstances()?.bnPriceWs.onPriceChange(() => {
    const position = getPositionToWatch();
    if (!position) {
      return;
    }

    const bnPrice = getDataFlowInstances()?.bnPriceWs.getLatestPriceData();
    const polyPrice = predictPriceHistory[predictPriceHistory.length - 1] ?? {
      value: bnPrice.value,
      timestamp: Date.now(),
    };

    if (bnPrice.timestamp < polyPrice.timestamp) {
      logStrategy(
        `[🤔Hold][🙏watchingPosition][👽bnPriceWs.onPriceChange] BN 实时性落后
        ${JSON.stringify({
          outcome: position.outcome,
          bnPrice: bnPrice.value,
          bnTimestamp: bnPrice.timestamp,
          polyPrice: polyPrice.value,
          polyTimestamp: polyPrice.timestamp,
          cost: Date.now() - bnPrice.receivedAt,
        })}
        `
      );
      return;
    }

    const orderBook = getOrderBookOfOutcomes(outcomes);
    const bestBid = orderBook[position.outcome]?.bestBid;
    const bnPriceHistory = getDataFlowInstances()?.bnPriceWs.getPriceHistory();

    const { predictedNewPrice } = predictSpreadChange(
      bnPriceHistory,
      predictPriceHistory,
      bnPrice.value,
      polyPrice.value
    );
    predictPriceHistory.push({
      value: predictedNewPrice,
      timestamp: Date.now(),
      receivedAt: Date.now(),
    });
    const decisionResult = decision(
      predictPriceHistory,
      priceToBeat,
      distanceToNextInterval(slugIntervalTimestamp)
    );
    const currentSide = polyPrice.value > priceToBeat ? OUTCOMES_ENUM.Up : OUTCOMES_ENUM.Down;

    const predictwinProbability =
      decisionResult.side === position.outcome
        ? decisionResult.winProbability
        : 1 - decisionResult.winProbability;

    if (
      predictwinProbability < config.stratgegy.sellPredictProbabilityThreshold &&
      bestBid < config.stratgegy.sellProbabilityThreshold &&
      decisionResult.side != position.outcome &&
      currentSide != position.outcome
    ) {
      getTrader().tradeTaskManage.addTask({
        tokenId: outcomes[position.outcome],
        action: TRADE_ACTION_ENUM.sell,
        price: bestBid,
        size: position.size,
        outcome: position.outcome,
      });

      logStrategy(
        `[❗️Sell][🙏watchingPosition][👽bnPriceWs.onPriceChange] 预测价格胜率 和 订单簿BestBid 都概率低于阈值
        ${JSON.stringify({
          outcome: position.outcome,
          predictSide: decisionResult.side,
          currentSide: currentSide,
          bestBid: bestBid,
          predictWinProbability: decisionResult.winProbability,
          bnPrice: bnPrice.value,
          polyPrice: polyPrice.value,
          predictNewPrice: predictedNewPrice,
          priceToBeat: priceToBeat,
          probabilityBasedOnGBM: decisionResult.probabilityBasedOnGBM,
          probabilityBasedOnBSM: decisionResult.probabilityBasedOnBSM,
          cost: Date.now() - bnPrice.receivedAt,
        })}
        `
      );
    } else {
      logStrategy(
        `[🤔Hold][🙏watchingPosition][👽bnPriceWs.onPriceChange]
        ${JSON.stringify({
          outcome: position.outcome,
          predictSide: decisionResult.side,
          currentSide: currentSide,
          bestBid: bestBid,
          predictWinProbability: decisionResult.winProbability,
          bnPrice: bnPrice.value,
          polyPrice: polyPrice.value,
          predictNewPrice: predictedNewPrice,
          priceToBeat: priceToBeat,
          probabilityBasedOnGBM: decisionResult.probabilityBasedOnGBM,
          probabilityBasedOnBSM: decisionResult.probabilityBasedOnBSM,
          cost: Date.now() - bnPrice.receivedAt,
        })}
        `
      );
    }
  });
};

export const startStrategy = async ({
  market,
  priceToBeat,
  slugIntervalTimestamp,
}: {
  market: TMarketResponseData;
  priceToBeat: number;
  slugIntervalTimestamp: number;
}) => {
  logInfo(`[🤞findingChanceAndBuying] 开始执行...`);
  findingChanceAndBuying({ market, priceToBeat, slugIntervalTimestamp });
  logInfo(`[🤞watchingPosition] 开始执行...`);
  watchingPosition({ market, priceToBeat, slugIntervalTimestamp });

  await waitFor(distanceToNextInterval(slugIntervalTimestamp));
};

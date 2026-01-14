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
import { Aligner } from "./decision/Aligner";
import { detectPriceChange } from "./decision/detectPriceChange";
import { predictPrice } from "./decision/predictPrice";

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
    const tradeLimitation = getTrader().getTradeLimitation();
    return distanceToNextInterval(slugIntervalTimestamp) > 0 && tradeLimitation.canBuy;
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
          amount: getTrader().maxTradeAmount - getTrader().position.getPosition().amount,
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

  const shouldWatching = () => {
    const tradeLimitation = getTrader().getTradeLimitation();
    return distanceToNextInterval(slugIntervalTimestamp) > 0 && tradeLimitation.canSell;
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

const logRecord = {};
const logStrategOnce = (key: string, message: string) => {
  if (logRecord[key]) {
    return;
  }
  logRecord[key] = true;
  logStrategy(message);
};

const watchingChance = async (params: {
  market: TMarketResponseData;
  priceToBeat: number;
  slugIntervalTimestamp: number;
}) => {
  const { market, priceToBeat, slugIntervalTimestamp } = params;
  const tokenIds = {
    [OUTCOMES_ENUM.Up]: getTokenIdFromMarketByOutcome(market, OUTCOMES_ENUM.Up),
    [OUTCOMES_ENUM.Down]: getTokenIdFromMarketByOutcome(market, OUTCOMES_ENUM.Down),
  };
  const { polyPriceWs, bnPriceWs, polyOrderBookWs } = dataFlow.getInstances();
  const config = getConfig();

  let polyPriceAligner: Aligner | null = null;
  let bnPriceAligner: Aligner | null = null;
  let chance: IChance | null = null;

  const isReadyToRunStrategy = () => {
    if (
      distanceToNextInterval(slugIntervalTimestamp) < 0 ||
      !getTrader().getTradeLimitation().canBuy
    ) {
      return false;
    }
    const polyPriceHistory = polyPriceWs.getPriceHistory();
    const bnPriceHistory = bnPriceWs.getPriceHistory();
    const upBestAsk =
      polyOrderBookWs.getLatestOrderBookData(tokenIds[OUTCOMES_ENUM.Up])?.[
        tokenIds[OUTCOMES_ENUM.Up]
      ]?.bestAsk ?? 0;
    const downBestAsk =
      polyOrderBookWs.getLatestOrderBookData(tokenIds[OUTCOMES_ENUM.Down])?.[
        tokenIds[OUTCOMES_ENUM.Down]
      ]?.bestAsk ?? 0;

    if (
      Math.min(bnPriceHistory.length, polyPriceHistory.length) > config.strategy.minDataPoints &&
      Math.min(upBestAsk, downBestAsk) > 0.01
    ) {
      // 数据量达标
      if (polyPriceAligner && bnPriceAligner) {
        // 有对齐器
        return true;
      } else {
        // 创建对齐器，本次也不参与计算
        const startTimestamp = Math.max(polyPriceHistory[0].timestamp, bnPriceHistory[0].timestamp);
        polyPriceAligner = new Aligner(startTimestamp, config.strategy.alignWindowMs);
        bnPriceAligner = new Aligner(startTimestamp, config.strategy.alignWindowMs);
        polyPriceAligner.align(polyPriceHistory);
        bnPriceAligner.align(bnPriceHistory);

        logStrategy("数据对齐完成...");
      }
    }
    return false;
  };

  polyPriceWs.onPriceChange((polyPrice) => {
    if (!isReadyToRunStrategy()) {
      return;
    }
    logStrategOnce("polyPriceChange", `开始执行策略`);
    polyPriceAligner?.addData(polyPrice);
  });

  bnPriceWs.onPriceChange((bnPrice) => {
    const startTime = Date.now();
    if (!isReadyToRunStrategy()) {
      return;
    }
    logStrategOnce("bnPriceChange", `开始执行策略`);
    bnPriceAligner?.addData(bnPrice);
    const alignedPolyPrice = polyPriceAligner.getAlignedData();
    const alignedBnPrice = bnPriceAligner.getAlignedData();
    if (alignedBnPrice.length < alignedPolyPrice.length) {
      logStrategy(
        `bn价格更新落后于poly价格，不参与计算..., bnPriceLength: ${alignedBnPrice.length}, polyPriceLength: ${alignedPolyPrice.length}`
      );
      // 说明bn价格更新落后于poly价格，不参与计算
      return;
    }
    const bnPriceChange = detectPriceChange(alignedBnPrice, {
      minChangeRateThreshold: 0.1,
      stabilityThreshold: 0.004,
      trendWindowSize: 30,
    });
    if (bnPriceChange.isConfirmed) {
      logStrategy(`bn价格波动确认..., bnPriceChange: ${JSON.stringify(bnPriceChange)}`);
      const { predictedB: predictedPolyPriceList } = predictPrice(alignedBnPrice, alignedPolyPrice);
      const { probUp, probDown, confidence } = calculateProbabilityBasedOnBSM(
        predictedPolyPriceList,
        priceToBeat,
        distanceToNextInterval(slugIntervalTimestamp)
      );
      const upOrderbook = polyOrderBookWs.getLatestOrderBookData(tokenIds[OUTCOMES_ENUM.Up])?.[
        tokenIds[OUTCOMES_ENUM.Up]
      ];
      const downOrderbook = polyOrderBookWs.getLatestOrderBookData(tokenIds[OUTCOMES_ENUM.Down])?.[
        tokenIds[OUTCOMES_ENUM.Down]
      ];
      if (
        confidence > config.strategy.bsmConfidenceThreshold &&
        Math.abs(probUp - upOrderbook.bestAsk) > config.strategy.buyInProbMinGap
      ) {
        const outcome = probUp > upOrderbook.bestAsk ? OUTCOMES_ENUM.Up : OUTCOMES_ENUM.Down; // 通过 up的概率差值判断即可
        const buyPrice = outcome === OUTCOMES_ENUM.Up ? upOrderbook.bestAsk : downOrderbook.bestAsk;

        const probAdvantage =
          outcome === OUTCOMES_ENUM.Up
            ? probUp - upOrderbook.bestAsk
            : probDown - downOrderbook.bestAsk;

        const stopProfitPrice = Number(
          (probAdvantage * config.strategy.stopProfitFactor + Number(buyPrice)).toFixed(2)
        );

        const stopLossPrice = calculateStopLoss({
          bsmProbability: outcome === OUTCOMES_ENUM.Up ? probUp : probDown,
          confidence,
          timeToExpiryMs: distanceToNextInterval(slugIntervalTimestamp),
          buyPrice,
          probAdvantage:
            outcome === OUTCOMES_ENUM.Up
              ? probUp - upOrderbook.bestAsk
              : probDown - downOrderbook.bestAsk,
          outcome,
        });
        chance = {
          assetId: tokenIds[outcome],
          outcome,
          buyPrice,
          stopProfitPrice,
          stopLossPrice,
        };
        logStrategy(`=== 💡找到机会 ===
          ${JSON.stringify({ ...chance, calcCost: `${Date.now() - startTime}ms` })}
        `);
        getTrader().tradeTaskManage.addTask({
          tokenId: tokenIds[chance.outcome],
          action: TRADE_ACTION_ENUM.buy,
          price: chance.buyPrice,
          outcome: chance.outcome,
          amount: getTrader().maxTradeAmount - getTrader().position.getPosition().amount,
        });
      } else {
        logStrategy(`=== bn价格波动确认, 但未找到机会 ===
          ${JSON.stringify({ calcCost: `${Date.now() - startTime}ms` })}
        `);
      }
    } else {
      logStrategOnce(
        "bnPriceChange",
        `bn价格波动未确认..., bnPriceChange: ${JSON.stringify(bnPriceChange)}`
      );
    }
  });

  polyOrderBookWs.onOrderBookChange(() => {
    if (
      distanceToNextInterval(slugIntervalTimestamp) > 0 ||
      !getTrader().getTradeLimitation().canSell
    ) {
      return;
    }
    logStrategOnce("onOrderBookChange", `开始执行策略`);
    const position = getTrader().position.getPosition();
    const tokenId = getTokenIdFromMarketByOutcome(market, position.outcome);
    const bestBid = polyOrderBookWs.getLatestOrderBookData(tokenId)?.[tokenId]?.bestBid;
    if (
      bestBid &&
      (Number(bestBid) <= chance.stopLossPrice || Number(bestBid) >= chance.stopProfitPrice)
    ) {
      logStrategy(`=== 💡卖出 ===
        ${JSON.stringify(chance)}
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
  watchingChance({ market, priceToBeat, slugIntervalTimestamp });

  await waitFor(distanceToNextInterval(slugIntervalTimestamp));
};

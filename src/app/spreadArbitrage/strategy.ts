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
        logStrategOnce("watchingChance", "数据已对齐，可以开始执行策略");
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
    const collectTime = Date.now() - 3 * 60 * 1000;
    const calcBnPriceList = alignedBnPrice.filter((item) => item.timestamp > collectTime);
    const calcPolyPriceList = alignedPolyPrice.filter((item) => item.timestamp > collectTime);

    const { predictedB: predictedPolyPriceList } = predictPrice(calcBnPriceList, calcPolyPriceList);
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

import { MarketResponse } from "@crypto15min/module/gammaData";
import { customTypeLog, logInfo } from "@crypto15min/module/logger";
import { race } from "./race";
import { TOKEN_ACTION_ENUM, distanceToNextInterval } from "./tools";
import { getGlobalConfig } from "./config";
import { OUTCOMES_ENUM } from "./constans";
import { decideTailSweep } from "./decision";
import { calcDiffEnough } from "./calc";
import { getDataFlowInstances } from "@crypto15min/module/dataFlow";
import { OrderBookData } from "@shared/ws/PolyOrderBookWs";
import { PriceData } from "@shared/ws/BnPriceWs";
import { predictSpreadChange } from "@shared/algorithm/spreadPredictor";

const getOutcomeByAssetId = (market: MarketResponse, assetId: string) => {
  const { clobTokenIds, outcomes } = market;
  const tokenIds = JSON.parse(clobTokenIds) as string[];
  const index = tokenIds.findIndex((id) => id === assetId);
  return JSON.parse(outcomes)[index] as string;
};

const getAssetIdMapOutcome = (market: MarketResponse) => {
  const outcomes: { [key: string]: string } = {};
  const tokenIds = JSON.parse(market.clobTokenIds) as string[];
  tokenIds.forEach((id) => {
    outcomes[getOutcomeByAssetId(market, id)] = id;
  });
  return outcomes;
};

export const findChance = async (
  market: MarketResponse,
  priceToBeat: number,
  timeout: number,
  slugIntervalTimestamp: number
) => {
  const globalConfig = getGlobalConfig();
  const outcomes = getAssetIdMapOutcome(market);

  logInfo(`[findChance] outcomes: ${JSON.stringify(outcomes)}`);

  return await race(
    new Promise((resolve) => {
      let resolved = false;

      try {
        getDataFlowInstances()?.polyOrderBookWs.onOrderBookChange((data: OrderBookData) => {
          if (resolved) {
            return;
          }
          const distance = distanceToNextInterval(slugIntervalTimestamp);
          if (distance <= 0) {
            resolved = true;
            resolve(null);
          }

          const upBestAsk = data[outcomes[OUTCOMES_ENUM.Up]]?.bestAsk ?? 0;
          const downBestAsk = data[outcomes[OUTCOMES_ENUM.Down]]?.bestAsk ?? 0;

          if (Math.max(upBestAsk, downBestAsk) >= globalConfig.stratgegy.bestAskThreshold) {
            const bestAsk = Math.max(upBestAsk, downBestAsk);
            const historyPriceList = getDataFlowInstances()?.polyPriceWs.getPriceHistory();
            const currentPrice = getDataFlowInstances()?.polyPriceWs.getLatestPriceData();
            const tailSweepResult = decideTailSweep(
              {
                ticks: historyPriceList,
                intervalStartPrice: priceToBeat,
                timeToExpiryMs: distance,
                upBestAsk,
                downBestAsk,
              },
              globalConfig.stratgegy.tailSweepConfig
            );
            const { isDiffEnough, avaliableValue } = calcDiffEnough(
              tailSweepResult.winProbability,
              0.95,
              [0.047, 0.0001],
              distance
            );
            customTypeLog(
              "strategy",
              `[-- 扫尾盘数据策略数据 (📚订单簿变动触发) --] ${JSON.stringify({
                priceToBeat,
                currentPrice,
                isDiffEnough,
                avaliableValue,
                bestAsk: data[outcomes[tailSweepResult.side]]?.bestAsk,
                ...tailSweepResult,
              })}`
            );

            if (tailSweepResult.shouldBet && isDiffEnough) {
              if (
                data[outcomes[tailSweepResult.side]]?.bestAsk >=
                globalConfig.stratgegy.bestAskThreshold
              ) {
                // 再次确认是否可以买入
                resolved = true;
                resolve({
                  tokenId: outcomes[tailSweepResult.side],
                  outcome: tailSweepResult.side,
                  cryptoPrice: currentPrice,
                  bestAsk,
                  priceToBeat,
                });
              } else {
                customTypeLog("strategy", "=======预测结果和实际订单簿情况不一致========");
              }
            }
          }
        });
      } catch (e) {
        logInfo(`findChanceByWatchPrice failed! ${e}`);
        resolved = true;
        resolve(null);
      }
    }),
    timeout > 0 ? timeout : 0
  );
};

export const watchPosition = async (
  market: MarketResponse,
  priceToBeat: number,
  outcome: OUTCOMES_ENUM,
  timeout: number,
  slugIntervalTimestamp: number
) => {
  const globalConfig = getGlobalConfig();
  const outcomes = getAssetIdMapOutcome(market);

  const result = await race(
    new Promise((resolve) => {
      let resolved = false;
      let predictPriceHistory: PriceData[] = [];

      getDataFlowInstances()?.polyPriceWs.onPriceChange((data: PriceData) => {
        if (resolved || distanceToNextInterval(slugIntervalTimestamp) <= 0) {
          return;
        }
        const startTime = Date.now();
        const polHitoryPrice = getDataFlowInstances()?.polyPriceWs.getPriceHistory();
        predictPriceHistory = [...polHitoryPrice];
        const { winProbability, side } = decideTailSweep({
          ticks: polHitoryPrice,
          intervalStartPrice: priceToBeat,
          timeToExpiryMs: distanceToNextInterval(slugIntervalTimestamp),
          upBestAsk: 0.5,
          downBestAsk: 0.5,
        });
        const predictwinProbability = side === outcome ? winProbability : 1 - winProbability;
        const orderBookData = getDataFlowInstances()?.polyOrderBookWs.getLatestOrderBookData(
          outcomes[outcome]
        );
        const bestBid = orderBookData[outcomes[outcome]]?.bestBid;
        const currentSide = data.value > priceToBeat ? OUTCOMES_ENUM.Up : OUTCOMES_ENUM.Down;

        if (
          Math.max(predictwinProbability, bestBid) <
            globalConfig.stratgegy.sellProbabilityThreshold &&
          currentSide != side
        ) {
          resolved = true;
          resolve(TOKEN_ACTION_ENUM.sell);
          customTypeLog(
            "strategy",
            `[❗️Sell] [polyPriceWs.onPriceChange] 预测价格胜率、订单簿BestBid 都概率低于阈值, 当前价格与买入方向不一致
            ${JSON.stringify({
              outcoum: outcome,
              bestBid: bestBid,
              predictSide: side,
              predictWinProbability: winProbability,
              polyPrice: data.value,
              priceToBeat: priceToBeat,
              currentSide: currentSide,
              cost: Date.now() - startTime,
            })}`
          );
        } else {
          customTypeLog(
            "strategy",
            `[🤔Hold] [polyPriceWs.onPriceChange]
            ${JSON.stringify({
              outcoum: outcome,
              bestBid: bestBid,
              predictSide: side,
              predictWinProbability: winProbability,
              polyPrice: data.value,
              priceToBeat: priceToBeat,
              currentSide: currentSide,
              cost: Date.now() - startTime,
            })}`
          );
        }
      });

      getDataFlowInstances()?.bnPriceWs.onPriceChange((data: PriceData) => {
        if (resolved || distanceToNextInterval(slugIntervalTimestamp) <= 0) {
          return;
        }
        const startTime = Date.now();
        const bnPriceHistory = getDataFlowInstances()?.bnPriceWs.getPriceHistory();
        const bnPrice = getDataFlowInstances()?.bnPriceWs.getLatestPriceData();
        const polyPrice = predictPriceHistory[predictPriceHistory.length - 1];
        const orderBookData = getDataFlowInstances()?.polyOrderBookWs.getLatestOrderBookData(
          outcomes[outcome]
        );
        const bestBid = orderBookData[outcomes[outcome]]?.bestBid;

        if (bnPrice.timestamp < polyPrice.timestamp) {
          customTypeLog(
            "strategy",
            `[🤔Hold] [bnPriceWs.onPriceChange] BN价格 实时性落后 Poly价格
            ${JSON.stringify({
              outcoum: outcome,
              bnPrice: bnPrice.value,
              bnTimestamp: bnPrice.timestamp,
              polyPrice: polyPrice.value,
              polyTimestamp: polyPrice.timestamp,
            })}`
          );
          return;
        }

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
        const { winProbability, side } = decideTailSweep({
          ticks: predictPriceHistory,
          intervalStartPrice: priceToBeat,
          timeToExpiryMs: distanceToNextInterval(slugIntervalTimestamp),
          upBestAsk: 0.5,
          downBestAsk: 0.5,
        });
        const predictwinProbability = side === outcome ? winProbability : 1 - winProbability;

        if (
          Math.max(bestBid, predictwinProbability) <
            globalConfig.stratgegy.sellProbabilityThreshold &&
          side === outcome
        ) {
          resolved = true;
          resolve(TOKEN_ACTION_ENUM.sell);
          customTypeLog(
            "strategy",
            `[❗️Sell] [bnPriceWs.onPriceChange] 预测价格胜率 和 订单簿BestBid 都概率低于阈值
            ${JSON.stringify({
              outcoum: outcome,
              bestBid: bestBid,
              predictSide: side,
              predictWinProbability: winProbability,
              priceToBeat: priceToBeat,
              bnPrice: bnPrice.value,
              polyPrice: polyPrice.value,
              predictNewPrice: predictedNewPrice,
              cost: Date.now() - startTime,
            })}`
          );
        } else {
          customTypeLog(
            "strategy",
            `[🤔Hold] [bnPriceWs.onPriceChange] 
            ${JSON.stringify({
              outcoum: outcome,
              bestBid: bestBid,
              predictSide: side,
              predictWinProbability: winProbability,
              priceToBeat: priceToBeat,
              bnPrice: bnPrice.value,
              polyPrice: polyPrice.value,
              predictNewPrice: predictedNewPrice,
              cost: Date.now() - startTime,
            })}`
          );
        }
      });
    }),
    timeout > 0 ? timeout : 0
  );

  if (result) {
    return result;
  }

  return TOKEN_ACTION_ENUM.hold;
};

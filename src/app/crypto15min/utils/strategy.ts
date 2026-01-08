import { MarketResponse } from "@crypto15min/module/gammaData";
import { customTypeLog, logInfo } from "@crypto15min/module/logger";
import { race } from "./race";
import { TOKEN_ACTION_ENUM, distanceToNextInterval } from "./tools";
import { getGlobalConfig } from "./config";
import { OUTCOMES_ENUM } from "./constans";
import { decideTailSweep } from "./decision";
import { calcDiffEnough } from "./calc";
import { getDataFlowInstances } from "@crypto15min/module/dataFlow";

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
        getDataFlowInstances()?.polyOrderBookWs.onOrderBookChange(() => {
          if (resolved) {
            return;
          }
          const distance = distanceToNextInterval(slugIntervalTimestamp);
          if (distance <= 0) {
            resolved = true;
            resolve(null);
          }

          const upOderBook = getDataFlowInstances()?.polyOrderBookWs.getLatestOrderBookData(
            outcomes[OUTCOMES_ENUM.Up]
          );
          const downOderBook = getDataFlowInstances()?.polyOrderBookWs.getLatestOrderBookData(
            outcomes[OUTCOMES_ENUM.Down]
          );

          const orderBookOfOutcomes = {
            [OUTCOMES_ENUM.Up]: upOderBook[outcomes[OUTCOMES_ENUM.Up]],
            [OUTCOMES_ENUM.Down]: downOderBook[outcomes[OUTCOMES_ENUM.Down]],
          };
          const bestAskOfOutcomes = {
            [OUTCOMES_ENUM.Up]: upOderBook[outcomes[OUTCOMES_ENUM.Up]]?.bestAsk ?? 0,
            [OUTCOMES_ENUM.Down]: downOderBook[outcomes[OUTCOMES_ENUM.Down]]?.bestAsk ?? 0,
          };
          const asksVolumeOfOutcomes = {
            [OUTCOMES_ENUM.Up]: upOderBook[outcomes[OUTCOMES_ENUM.Up]]?.asksVolume ?? 0,
            [OUTCOMES_ENUM.Down]: downOderBook[outcomes[OUTCOMES_ENUM.Down]]?.asksVolume ?? 0,
          };

          if (
            Math.max(bestAskOfOutcomes[OUTCOMES_ENUM.Up], bestAskOfOutcomes[OUTCOMES_ENUM.Down]) >=
            globalConfig.stratgegy.bestAskThreshold
          ) {
            const historyPriceList = getDataFlowInstances()?.polyPriceWs.getPriceHistory();
            const currentPrice = getDataFlowInstances()?.polyPriceWs.getLatestPriceData();
            const tailSweepResult = decideTailSweep(
              {
                ticks: historyPriceList,
                intervalStartPrice: priceToBeat,
                timeToExpiryMs: distance,
                upBestAsk: bestAskOfOutcomes[OUTCOMES_ENUM.Up],
                downBestAsk: bestAskOfOutcomes[OUTCOMES_ENUM.Down],
              },
              globalConfig.stratgegy.tailSweepConfig
            );
            const { isDiffEnough, avaliableValue: acceptableWinProbability } = calcDiffEnough(
              tailSweepResult.winProbability,
              0.95,
              [0.047, 0.0001],
              [globalConfig.stratgegy.startStrategyBefore, 0],
              distance
            );
            if (
              tailSweepResult.shouldBet &&
              isDiffEnough &&
              bestAskOfOutcomes[tailSweepResult.side] >= globalConfig.stratgegy.bestAskThreshold &&
              bestAskOfOutcomes[tailSweepResult.side] <= 0.99
            ) {
              resolved = true;
              resolve({
                tokenId: outcomes[tailSweepResult.side],
                outcome: tailSweepResult.side,
                cryptoPrice: currentPrice,
                bestAsk: Number(bestAskOfOutcomes[tailSweepResult.side].toFixed(2)),
                asksVolume: asksVolumeOfOutcomes[tailSweepResult.side],
                priceToBeat,
              });
              customTypeLog(
                "strategy",
                `[✅Buy] [polyOrderBookWs.onOrderBookChange] 
                ${JSON.stringify({
                  shouldBet: tailSweepResult.shouldBet,
                  side: tailSweepResult.side,
                  acceptableWinProbability,
                  winProbability: tailSweepResult.winProbability,
                  isDiffEnough,
                  bestAsk: bestAskOfOutcomes[tailSweepResult.side],
                  priceToBeat,
                  currentPrice: currentPrice?.value,
                  asksVolume: asksVolumeOfOutcomes[tailSweepResult.side],
                  cost: Date.now() - orderBookOfOutcomes[tailSweepResult.side].receivedAt,
                })}
                `
              );
            } else {
              customTypeLog(
                "strategy",
                `[⏩Wait] [polyOrderBookWs.onOrderBookChange] 
                ${JSON.stringify({
                  shouldBet: tailSweepResult.shouldBet,
                  side: tailSweepResult.side,
                  acceptableWinProbability,
                  winProbability: tailSweepResult.winProbability,
                  isDiffEnough,
                  bestAsk: bestAskOfOutcomes[tailSweepResult.side],
                  priceToBeat,
                  currentPrice: currentPrice?.value,
                  asksVolume: asksVolumeOfOutcomes[tailSweepResult.side],
                  cost: Date.now() - orderBookOfOutcomes[tailSweepResult.side].receivedAt,
                })}
                `
              );
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

      getDataFlowInstances()?.polyPriceWs.onPriceChange((polyPrice: PriceData) => {
        if (resolved || distanceToNextInterval(slugIntervalTimestamp) <= 0) {
          return;
        }

        const polHitoryPrice = getDataFlowInstances()?.polyPriceWs.getPriceHistory();
        predictPriceHistory = [...polHitoryPrice];
        const { winProbability, side: predictSide } = decideTailSweep({
          ticks: polHitoryPrice,
          intervalStartPrice: priceToBeat,
          timeToExpiryMs: distanceToNextInterval(slugIntervalTimestamp),
          upBestAsk: 0.5,
          downBestAsk: 0.5,
        });
        const predictwinProbability = predictSide === outcome ? winProbability : 1 - winProbability;
        const orderBookData = getDataFlowInstances()?.polyOrderBookWs.getLatestOrderBookData(
          outcomes[outcome]
        );
        const bestBid = orderBookData[outcomes[outcome]]?.bestBid;
        const currentSide = polyPrice.value > priceToBeat ? OUTCOMES_ENUM.Up : OUTCOMES_ENUM.Down;

        if (
          predictwinProbability < globalConfig.stratgegy.sellProbabilityThreshold &&
          predictSide != outcome
        ) {
          resolved = true;
          resolve(TOKEN_ACTION_ENUM.sell);
          customTypeLog(
            "strategy",
            `[❗️Sell] [😈polyPriceWs.onPriceChange] 预测价格胜率、订单簿BestBid 都概率低于阈值, 当前价格与买入方向不一致
            ${JSON.stringify({
              outcome: outcome,
              bestBid: bestBid,
              predictSide,
              predictWinProbability: winProbability,
              polyPrice: polyPrice.value,
              priceToBeat: priceToBeat,
              currentSide: currentSide,
              cost: Date.now() - polyPrice.receivedAt,
            })}
            `
          );
        } else {
          customTypeLog(
            "strategy",
            `[🤔Hold] [😈polyPriceWs.onPriceChange]
            ${JSON.stringify({
              outcome: outcome,
              bestBid: bestBid,
              predictSide,
              predictWinProbability: winProbability,
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
        if (resolved || distanceToNextInterval(slugIntervalTimestamp) <= 0) {
          return;
        }
        const bnPriceHistory = getDataFlowInstances()?.bnPriceWs.getPriceHistory();
        const bnPrice = getDataFlowInstances()?.bnPriceWs.getLatestPriceData();
        const polyPrice = predictPriceHistory[predictPriceHistory.length - 1] ?? {
          value: bnPrice.value,
          timestamp: Date.now(),
        };
        const orderBookData = getDataFlowInstances()?.polyOrderBookWs.getLatestOrderBookData(
          outcomes[outcome]
        );
        const bestBid = orderBookData[outcomes[outcome]]?.bestBid;

        if (bnPrice.timestamp < polyPrice.timestamp) {
          customTypeLog(
            "strategy",
            `[🤔Hold] [👽bnPriceWs.onPriceChange] BN 实时性落后
            ${JSON.stringify({
              outcome: outcome,
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
        const { winProbability, side: predictSide } = decideTailSweep({
          ticks: predictPriceHistory,
          intervalStartPrice: priceToBeat,
          timeToExpiryMs: distanceToNextInterval(slugIntervalTimestamp),
          upBestAsk: 0.5,
          downBestAsk: 0.5,
        });
        const predictwinProbability = predictSide === outcome ? winProbability : 1 - winProbability;

        if (
          predictwinProbability < globalConfig.stratgegy.sellProbabilityThreshold &&
          predictSide === outcome
        ) {
          resolved = true;
          resolve(TOKEN_ACTION_ENUM.sell);
          customTypeLog(
            "strategy",
            `[❗️Sell] [👽bnPriceWs.onPriceChange] 预测价格胜率 和 订单簿BestBid 都概率低于阈值
            ${JSON.stringify({
              outcome: outcome,
              bestBid: bestBid,
              predictSide,
              predictWinProbability: winProbability,
              priceToBeat: priceToBeat,
              bnPrice: bnPrice.value,
              polyPrice: polyPrice.value,
              predictNewPrice: predictedNewPrice,
              cost: Date.now() - bnPrice.receivedAt,
            })}
            `
          );
        } else {
          customTypeLog(
            "strategy",
            `[🤔Hold] [👽bnPriceWs.onPriceChange] 
            ${JSON.stringify({
              outcome: outcome,
              bestBid: bestBid,
              predictSide,
              predictWinProbability: winProbability,
              priceToBeat: priceToBeat,
              bnPrice: bnPrice.value,
              polyPrice: polyPrice.value,
              predictNewPrice: predictedNewPrice,
              cost: Date.now() - bnPrice.receivedAt,
            })}
            `
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

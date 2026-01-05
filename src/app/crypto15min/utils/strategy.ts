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
              "PolyOrderBookWs",
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
                data[outcomes[tailSweepResult.side]]?.bestAsk >
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
                customTypeLog("PolyOrderBookWs", "=======预测结果和实际订单簿情况不一致========");
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

      getDataFlowInstances()?.polyPriceWs.onPriceChange((data: PriceData) => {
        if (resolved || distanceToNextInterval(slugIntervalTimestamp) <= 0) {
          return;
        }
        if (
          (data.value > priceToBeat && outcome === OUTCOMES_ENUM.Down) ||
          (data.value < priceToBeat && outcome === OUTCOMES_ENUM.Up)
        ) {
          resolved = true;
          resolve(TOKEN_ACTION_ENUM.sell);
          const latency = Date.now() - data?.timestamp;
          customTypeLog(
            "PolyOrderBookWs",
            `[买入后价格检查(低于阈值💰) polyPriceWs] 
                outcoum: ${outcome}, 
                priceToBeat: ${priceToBeat}, 
                currentPrice: ${data?.value}
                latency: ${latency}
            `
          );
        }
      });

      getDataFlowInstances()?.polyOrderBookWs.onOrderBookChange((data: OrderBookData) => {
        if (resolved || distanceToNextInterval(slugIntervalTimestamp) <= 0) {
          return;
        }
        const startTime = Date.now();
        const assetId = outcomes[outcome];
        const bestBid = data[assetId]?.bestBid;
        const latency = Date.now() - data[assetId]?.timestamp;

        if (bestBid && bestBid < globalConfig.stratgegy.sellProbabilityThreshold) {
          const bnPriceHistory = getDataFlowInstances()?.bnPriceWs.getPriceHistory();
          const polyPriceHistory = getDataFlowInstances()?.polyPriceWs.getPriceHistory();
          const bnPrice = getDataFlowInstances()?.bnPriceWs.getLatestPriceData();
          const polyPrice = getDataFlowInstances()?.polyPriceWs.getLatestPriceData();
          const { predictedNewPrice } = predictSpreadChange(
            bnPriceHistory,
            polyPriceHistory,
            bnPrice.value,
            polyPrice.value
          );

          if (
            (Math.min(predictedNewPrice, polyPrice.value) > priceToBeat &&
              outcome === OUTCOMES_ENUM.Down) ||
            (Math.max(predictedNewPrice, polyPrice.value) < priceToBeat &&
              outcome === OUTCOMES_ENUM.Up)
          ) {
            resolved = true;
            resolve(TOKEN_ACTION_ENUM.sell);

            customTypeLog(
              "PolyOrderBookWs",
              `[买入后概率检查(低于阈值📚)] 价格满足条件
                    outcoum: ${outcome}, 
                    bestBid: ${bestBid}, 
                    assetId: ${assetId}, 
                    priceToBeat: ${priceToBeat},
                    predictedNewPrice: ${predictedNewPrice},
                    polyPrice: ${polyPrice.value},
                    bnPrice: ${bnPrice.value},
                    latency: ${latency},
                    cost: ${Date.now() - startTime}
                `
            );
          } else {
            customTypeLog(
              "PolyOrderBookWs",
              `[买入后概率检查(低于阈值📚)] 价格不满足条件
                    outcoum: ${outcome}, 
                    bestBid: ${bestBid}, 
                    assetId: ${assetId}, 
                    priceToBeat: ${priceToBeat},
                    predictedNewPrice: ${predictedNewPrice},
                    polyPrice: ${polyPrice.value},
                    bnPrice: ${bnPrice.value},
                    latency: ${latency},
                    cost: ${Date.now() - startTime}
                `
            );
          }
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

import { distanceToNextInterval, getAssetIdMapOutcome } from "@shared/marketUtils";
import { TMarketResponseData } from "@typings/gammaData";
import dataFlow from "./utils/dataFlow";
import { getConfig } from "./config";
import { calculateProbability } from "@shared/algorithm/bsm";
import { customTypeLog } from "./logger";
import { race } from "@shared/utils/race";
import { OUTCOMES_ENUM, WATCH_POSITION_ACTION_ENUM } from "@shared/constants";
import { predictSpreadChange } from "@shared/algorithm/spreadPredictor";
import { calculateStopLoss } from "./calc";

export interface IChance {
  assetId: string;
  outcome: OUTCOMES_ENUM;
  buyPrice: number;
  stopProfitPrice: number;
  stopLossPrice: number;
}

export const findChance = async (params: {
  market: TMarketResponseData;
  priceToBeat: number;
  slugIntervalTimestamp: number;
}): Promise<IChance | null> => {
  const { market, priceToBeat, slugIntervalTimestamp } = params;
  const assetIdMapOutcome = getAssetIdMapOutcome(market);
  const dataFlowInstances = dataFlow.getInstances();
  const config = getConfig();
  let resolved = false;

  return await race(
    new Promise((resolve) => {
      dataFlowInstances.bnPriceWs.onPriceChange((bnPrice) => {
        if (resolved || distanceToNextInterval(slugIntervalTimestamp) <= 0) return;

        const polyPrice = dataFlowInstances.polyPriceWs.getLatestPriceData();
        const upOrderbook = dataFlowInstances.polyOrderBookWs.getLatestOrderBookData(
          assetIdMapOutcome[OUTCOMES_ENUM.Up]
        );
        const downOrderbook = dataFlowInstances.polyOrderBookWs.getLatestOrderBookData(
          assetIdMapOutcome[OUTCOMES_ENUM.Down]
        );

        if (!polyPrice || !upOrderbook || !downOrderbook) return;

        const upBestAsk = upOrderbook[assetIdMapOutcome[OUTCOMES_ENUM.Up]].bestAsk;
        const downBestAsk = downOrderbook[assetIdMapOutcome[OUTCOMES_ENUM.Down]].bestAsk;
        const polyPriceHistory = dataFlowInstances.polyPriceWs.getPriceHistory();
        const bnPriceHistory = dataFlowInstances.bnPriceWs.getPriceHistory();

        if (
          Math.min(bnPriceHistory.length, polyPriceHistory.length) > config.startCalcMinDataPoints
        ) {
          // 开始计算的最小数据量
          const { predictedNewPrice } = predictSpreadChange(
            bnPriceHistory,
            polyPriceHistory,
            bnPrice.value,
            polyPrice.value
          );

          const bsmResult = calculateProbability(
            [
              ...polyPriceHistory,
              {
                value: predictedNewPrice,
                timestamp: Date.now(),
              },
            ],
            priceToBeat,
            distanceToNextInterval(slugIntervalTimestamp)
          );
          if (
            Math.max(
              bsmResult.probUp - Number(upBestAsk),
              bsmResult.probDown - Number(downBestAsk)
            ) > config.bsmProbThreshold
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

            const stopProfitPrice = (
              probAdvantage * config.stopProfitFactor +
              Number(buyPrice)
            ).toFixed(2);

            // 计算科学的止损点
            const stopLossPrice = calculateStopLoss({
              bsmProbability: outcome === OUTCOMES_ENUM.Up ? bsmResult.probUp : bsmResult.probDown,
              confidence: bsmResult.confidence,
              timeToExpiryMs: distanceToNextInterval(slugIntervalTimestamp),
              buyPrice,
              probAdvantage,
              outcome,
            });

            const result = {
              assetId: assetIdMapOutcome[outcome],
              outcome,
              buyPrice,
              stopProfitPrice,
              stopLossPrice,
            };
            customTypeLog(
              "Chance",
              `
                === 💡找到机会 ===    
                predictedNewPrice: ${predictedNewPrice},
                curentPrice: ${polyPrice.value},
                priceToBeat: ${priceToBeat},
                upBestAsk: ${upBestAsk},
                downBestAsk: ${downBestAsk},
                bsmResult: ${JSON.stringify(bsmResult)},
                chance: ${JSON.stringify(result)},
                calcCost: ${Date.now() - bnPrice.receivedAt}ms
              `
            );
            resolved = true;
            resolve(result);
          } else {
            customTypeLog(
              "Chance",
              `
                === 未找到机会 ===    
                predictedNewPrice: ${predictedNewPrice},
                curentPrice: ${polyPrice.value},
                priceToBeat: ${priceToBeat},
                upBestAsk: ${upBestAsk},
                downBestAsk: ${downBestAsk},
                bsmResult: ${JSON.stringify(bsmResult)},
                cost: ${Date.now() - bnPrice.receivedAt}ms
              `
            );
          }
        }
      });
    }),
    distanceToNextInterval(slugIntervalTimestamp)
  );
};

export const watchPosition = async (params: { chance: IChance; slugIntervalTimestamp: number }) => {
  const { chance, slugIntervalTimestamp } = params;
  const { assetId, stopProfitPrice, stopLossPrice } = chance;
  const dataFlowInstances = dataFlow.getInstances();
  let resolved = false;

  return await race(
    new Promise((resolve) => {
      dataFlowInstances.polyOrderBookWs.onOrderBookChange((orderBook) => {
        if (resolved || distanceToNextInterval(slugIntervalTimestamp) <= 0) return;
        const bestBid = orderBook[assetId]?.bestBid;
        if (bestBid && (Number(bestBid) <= stopLossPrice || Number(bestBid) >= stopProfitPrice)) {
          resolved = true;
          resolve({ action: WATCH_POSITION_ACTION_ENUM.sell, price: bestBid });
        }
      });
    }),
    distanceToNextInterval(slugIntervalTimestamp),
    () => {
      return WATCH_POSITION_ACTION_ENUM.hold;
    }
  );
};

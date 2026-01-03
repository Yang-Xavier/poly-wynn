import { distanceToNextInterval, getAssetIdMapOutcome } from "@shared/marketUtils";
import { TMarketResponseData } from "@typings/gammaData";
import dataFlow from "./utils/dataFlow";
import { getConfig } from "./config";
import { calculateBSM } from "@shared/algorithm/bsm";
import { customTypeLog } from "./logger";
import { race } from "@shared/utils/race";
import { OUTCOMES_ENUM } from "@crypto15min/utils/constans";
import { predictSpreadChange } from "@shared/algorithm/spreadPredictor";

export const findChance = async (params: {
  market: TMarketResponseData;
  priceToBeat: number;
  slugIntervalTimestamp: number;
}) => {
  const { market, priceToBeat, slugIntervalTimestamp } = params;
  const assetIdMapOutcome = getAssetIdMapOutcome(market);
  const dataFlowInstances = dataFlow.getInstances();
  const config = getConfig();
  let prevPriceGap = 0;
  let first = true;
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

        const upBestAsk = upOrderbook?.bestAsk;
        const downBestAsk = downOrderbook?.bestAsk;
        const priceGap = bnPrice.value - polyPrice.value;
        const priceGapDelta = priceGap - prevPriceGap;
        const deltaRate = Math.abs(priceGapDelta / prevPriceGap);
        const polyPriceHistory = dataFlowInstances.polyPriceWs.getPriceHistory();
        const bnPriceHistory = dataFlowInstances.bnPriceWs.getPriceHistory();

        if (bnPriceHistory.length > 50 && polyPriceHistory.length > 50) {
          const { predictedNewPrice } = predictSpreadChange(
            bnPriceHistory,
            polyPriceHistory,
            bnPrice.value,
            polyPrice.value
          );

          const bsmResult = calculateBSM(
            [
              ...polyPriceHistory,
              {
                value: predictedNewPrice,
                timestamp: Date.now(),
              },
            ],
            priceToBeat,
            0,
            distanceToNextInterval(slugIntervalTimestamp)
          );
          if (
            Math.abs(bsmResult.probUp - Number(upBestAsk)) > config.bsmProbThreshold ||
            Math.abs(bsmResult.probDown - Number(downBestAsk)) > config.bsmProbThreshold
          ) {
            customTypeLog(
              "Chance",
              `
                === 💡找到机会 ===    
                predictedNewPrice: ${predictedNewPrice},
                priceToBeat: ${priceToBeat},
                upBestAsk: ${upBestAsk},
                downBestAsk: ${downBestAsk},
                priceGap: ${priceGap},
                priceGapDelta: ${priceGapDelta},
                deltaRate: ${deltaRate},
                bsmResult: ${JSON.stringify(bsmResult)},
                distance: ${distanceToNextInterval(slugIntervalTimestamp)}
              `
            );
            const buyParams = {};
            const sellParams = {};
            if (downBestAsk < upBestAsk) {
              // 买低概率事件
              // 买入点
              Object.assign(buyParams, {
                assetId: assetIdMapOutcome.Down,
                outcome: OUTCOMES_ENUM.Down,
                targetPrice: downBestAsk,
              });
              // 卖出点
              Object.assign(sellParams, {
                assetId: assetIdMapOutcome.Down,
                outcome: OUTCOMES_ENUM.Down,
                targetPrice: ((bsmResult.probDown - Number(downBestAsk)) / 2).toFixed(2),
              });
            } else {
              // 买入点
              Object.assign(buyParams, {
                assetId: assetIdMapOutcome.Up,
                outcome: OUTCOMES_ENUM.Up,
                targetPrice: upBestAsk,
              });
              // 卖出点
              Object.assign(sellParams, {
                assetId: assetIdMapOutcome.Up,
                outcome: OUTCOMES_ENUM.Up,
                targetPrice: ((bsmResult.probUp - Number(upBestAsk)) / 2).toFixed(2),
              });
            }
            const result = {
              buyParams,
              sellParams,
            };
            resolved = true;
            resolve(result);
          } else {
            customTypeLog(
              "Chance",
              `
                === 未找到机会 ===    
                predictedNewPrice: ${predictedNewPrice},
                priceToBeat: ${priceToBeat},
                upBestAsk: ${upBestAsk},
                downBestAsk: ${downBestAsk},
                priceGap: ${priceGap},
                priceGapDelta: ${priceGapDelta},
                deltaRate: ${deltaRate},
                bsmResult: ${JSON.stringify(bsmResult)},
                distance: ${distanceToNextInterval(slugIntervalTimestamp)}
              `
            );
          }
        }
        prevPriceGap = priceGap;
        first = false;
      });
    }),
    distanceToNextInterval(slugIntervalTimestamp)
  );
};

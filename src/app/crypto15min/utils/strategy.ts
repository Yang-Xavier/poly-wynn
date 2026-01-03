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
              `[-- 扫尾盘数据策略数据 (📚订单簿变动触发) --] ${JSON.stringify({ priceToBeat, currentPrice, isDiffEnough, avaliableValue, ...tailSweepResult })}`
            );

            if (tailSweepResult.shouldBet && isDiffEnough) {
              resolved = true;
              resolve({
                tokenId: outcomes[tailSweepResult.side],
                outcome: tailSweepResult.side,
                cryptoPrice: currentPrice,
                bestAsk,
                priceToBeat,
              });
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
      let prevGap = 0;

      getDataFlowInstances()?.polyOrderBookWs.onOrderBookChange((data: OrderBookData) => {
        if (resolved || distanceToNextInterval(slugIntervalTimestamp) <= 0) {
          return;
        }
        const assetId = outcomes[outcome];
        const bestAsk = data[assetId]?.bestAsk;
        const latency = Date.now() - data[assetId]?.timestamp;
        const polyData = getDataFlowInstances()?.polyPriceWs.getLatestPriceData();
        const bnData = getDataFlowInstances()?.bnPriceWs.getLatestPriceData();
        const currentGap = bnData?.value - polyData?.value;
        const gapDelt = currentGap - prevGap;
        const ajustedPolyPrice = polyData?.value + gapDelt;

        if (
          (ajustedPolyPrice < priceToBeat && outcome === OUTCOMES_ENUM.Up) ||
          (ajustedPolyPrice > priceToBeat && outcome === OUTCOMES_ENUM.Down)
        ) {
          customTypeLog(
            "PolyOrderBookWs",
            `[买入后价格检查(低于阈值💰)] outcoum: ${outcome}, priceToBeat: ${priceToBeat}, currentPrice: ${polyData?.value}, ajustedPolyPrice: ${ajustedPolyPrice}, bestAsk: ${bestAsk}, assetId: ${assetId}, priceGap: ${currentGap}, latency: ${latency}`
          );
          resolved = true;
          resolve(TOKEN_ACTION_ENUM.sell);
        }

        if (bestAsk && bestAsk < globalConfig.stratgegy.sellProbabilityThreshold) {
          customTypeLog(
            "PolyOrderBookWs",
            `[买入后概率检查(低于阈值📚)] outcoum: ${outcome}, priceToBeat: ${priceToBeat}, currentPrice: ${polyData?.value}, ajustedPolyPrice: ${ajustedPolyPrice}, bestAsk: ${bestAsk}, assetId: ${assetId}, priceGap: ${currentGap}, latency: ${latency}`
          );
          resolved = true;
          resolve(TOKEN_ACTION_ENUM.sell);
        } else {
          customTypeLog(
            "PolyOrderBookWs",
            `[买入后概率检查(高于阈值📚)] outcoum: ${outcome}, priceToBeat: ${priceToBeat}, currentPrice: ${polyData?.value}, ajustedPolyPrice: ${ajustedPolyPrice}, bestAsk: ${bestAsk}, assetId: ${assetId}, priceGap: ${currentGap}, latency: ${latency}`
          );
        }
        prevGap = currentGap;
      });
    }),
    timeout > 0 ? timeout : 0
  );

  if (result) {
    return result;
  }

  return TOKEN_ACTION_ENUM.hold;
};

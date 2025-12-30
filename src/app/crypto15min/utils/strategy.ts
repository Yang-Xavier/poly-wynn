import { MarketResponse } from "@crypto15min/module/gammaData";
import { logData, logInfo } from "@crypto15min/module/logger";
import { polyMarketDataClient } from "./polyMarketData";
import { race } from "./race";
import { TOKEN_ACTION_ENUM, distanceToNextInterval } from "./tools";
import { getGlobalConfig } from "./config";
import { polyLiveDataClient } from "./polyLiveData";
import { OUTCOMES_ENUM } from "./constans";
import { decideTailSweep } from "./decision";
import { MarketPushData } from "./polyMarketData";
import { calcDiffEnough } from "./calc";

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
        polyMarketDataClient.onWatchOrderBookPriceChange((data: MarketPushData) => {
          if (resolved) {
            return;
          }
          const distance = distanceToNextInterval(slugIntervalTimestamp);
          if (distance <= 0) {
            resolved = true;
            resolve(null);
          }

          // 直接判断是Up还是Down，避免使用forEach
          let outcome: OUTCOMES_ENUM | null = null;
          if (data.asset_id === outcomes[OUTCOMES_ENUM.Up]) {
            outcome = OUTCOMES_ENUM.Up;
          } else if (data.asset_id === outcomes[OUTCOMES_ENUM.Down]) {
            outcome = OUTCOMES_ENUM.Down;
          }
          logData(`[findChance] outcome: ${outcome}`);
          if (outcome) {
            const bestAsk = data.asks[data.asks.length - 1]?.price;
            const historyPriceList = polyLiveDataClient.getHistoryPriceListFromChainLink();
            const currentPrice = polyLiveDataClient.getLatestCryptoPricesFromChainLink();

            if (bestAsk >= globalConfig.stratgegy.bestAskThreshold) {
              let tailSweepResult;
              if (outcome === OUTCOMES_ENUM.Up) {
                tailSweepResult = decideTailSweep(
                  {
                    ticks: historyPriceList,
                    intervalStartPrice: priceToBeat,
                    timeToExpiryMs: distance,
                    upBestAsk: Number(bestAsk),
                    downBestAsk: 0,
                  },
                  globalConfig.stratgegy.tailSweepConfig
                );
              } else if (outcome === OUTCOMES_ENUM.Down) {
                tailSweepResult = decideTailSweep(
                  {
                    ticks: historyPriceList,
                    intervalStartPrice: priceToBeat,
                    timeToExpiryMs: distance,
                    upBestAsk: 0,
                    downBestAsk: Number(bestAsk),
                  },
                  globalConfig.stratgegy.tailSweepConfig
                );
              }
              logData(`[findChance] tailSweepResult: ${tailSweepResult}`);

              const { isDiffEnough, avaliableValue } = calcDiffEnough(
                tailSweepResult.winProbability,
                0.95,
                [0.047, 0.0001],
                distance
              );
              logData(
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
          }
        });

        polyLiveDataClient.onWatchPriceChange((currentPrice, historyPriceList) => {
          try {
            if (resolved) {
              return;
            }
            const distance = distanceToNextInterval(slugIntervalTimestamp);
            if (distance <= 0) {
              resolved = true;
              resolve(null);
            }

            const upBestAsk = polyMarketDataClient.getBestAskByAssetId(outcomes[OUTCOMES_ENUM.Up]);
            const downBestAsk = polyMarketDataClient.getBestAskByAssetId(
              outcomes[OUTCOMES_ENUM.Down]
            );
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
            logData(
              `[-- 扫尾盘数据策略数据 (💰价格变动触发) --] ${JSON.stringify({ priceToBeat, currentPrice, isDiffEnough, avaliableValue, ...tailSweepResult })}`
            );

            if (
              tailSweepResult.shouldBet &&
              upBestAsk &&
              downBestAsk &&
              isDiffEnough &&
              tailSweepResult.impliedProbability >= globalConfig.stratgegy.bestAskThreshold
            ) {
              resolved = true;
              resolve({
                tokenId: outcomes[tailSweepResult.side],
                bestAsk: tailSweepResult.side === OUTCOMES_ENUM.Up ? upBestAsk : downBestAsk,
                outcome: tailSweepResult.side,
                cryptoPrice: currentPrice,
                priceToBeat,
              });
            }
          } catch (e) {}
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

      // polyMarketDataClient.onWatchOrderBookPriceChange((data: MarketPushData) => {
      //   if (resolved || distanceToNextInterval(slugIntervalTimestamp) <= 0) {
      //     return;
      //   }
      //   const assetId = outcomes[outcome];
      //   if (data.asset_id === assetId) {
      //     const bestAsk = data.asks[data.asks.length - 1]?.price;
      //     if (bestAsk && parseFloat(bestAsk) < globalConfig.stratgegy.sellProbabilityThreshold) {
      //       logData(
      //         `[买入后概率检查(低于阈值📚)] outcoum: ${outcome}, priceToBeat: ${priceToBeat}, bestAsk: ${bestAsk}, assetId: ${assetId}`
      //       );
      //       resolved = true;
      //       resolve(TOKEN_ACTION_ENUM.sell);
      //     } else {
      //       logData(
      //         `[买入后概率检查(高于阈值📚)] outcoum: ${outcome}, priceToBeat: ${priceToBeat}, bestAsk: ${bestAsk}, assetId: ${assetId}`
      //       );
      //     }
      //   }
      // });

      polyLiveDataClient.onWatchPriceChange((currentPrice, historyPriceList) => {
        if (resolved || distanceToNextInterval(slugIntervalTimestamp) <= 0) {
          return;
        }
        const currentOutCome =
          currentPrice.value - priceToBeat >= 0 ? OUTCOMES_ENUM.Up : OUTCOMES_ENUM.Down;
        const upBestAsk = polyMarketDataClient.getBestAskByAssetId(outcomes[OUTCOMES_ENUM.Up]);
        const downBestAsk = polyMarketDataClient.getBestAskByAssetId(outcomes[OUTCOMES_ENUM.Down]);
        const tailSweepResult = decideTailSweep(
          {
            ticks: historyPriceList,
            intervalStartPrice: priceToBeat,
            timeToExpiryMs: distanceToNextInterval(slugIntervalTimestamp),
            upBestAsk,
            downBestAsk,
          },
          globalConfig.stratgegy.tailSweepConfig
        );

        if (currentOutCome !== outcome && tailSweepResult.winProbability < 0.95) {
          logData(
            `[买入后价格检查(方向相反💰)] outcoum: ${outcome}, currentOutCome: ${currentOutCome}, priceToBeat: ${priceToBeat}, currentPrice: ${currentPrice.value}, tailSweepResult: ${JSON.stringify(tailSweepResult)}`
          );
          if (tailSweepResult.winProbability < 0.5) {
            logData(`[---- 胜率低于50%，立即卖出 ----]`);
            resolved = true;
            resolve(TOKEN_ACTION_ENUM.sell);
          }
        } else {
          logData(
            `[买入后价格检查(方向一致💰)] outcoum: ${outcome}, priceToBeat: ${priceToBeat}, currentPrice: ${currentPrice.value}, tailSweepResult: ${JSON.stringify(tailSweepResult)}`
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

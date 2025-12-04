
import { MarketResponse } from "../module/gammaData";
import { logData, logInfo } from "../module/logger";
import { polyMarketDataClient } from "./polyMarketData";
import { race } from "./race";
import { TOKEN_ACTION_ENUM, distanceToNextInterval } from "./tools";
import { getGlobalConfig } from "./config";
import { polyLiveDataClient } from "./polyLiveData";
import { OUTCOMES_ENUM } from "./constans";
import { calcBreakoutProbability, calcBreakoutProbabilityFromTicks, calcDiffBeatPrice, calcTrend } from "./calc";



const getOutcomeByAssetId = (market: MarketResponse, assetId: string) => {
    const { clobTokenIds, outcomes } = market;
    const tokenIds = JSON.parse(clobTokenIds) as string[];
    const index = tokenIds.findIndex(id => id === assetId);
    return JSON.parse(outcomes)[index] as string;
}

export const findChanceByWatchPrice = async (market: MarketResponse, priceToBeat: number, timeout: number, slugIntervalTimestamp: number) => {
    const globalConfig = getGlobalConfig();
    const outcomes: { [key: string]: string } = {};
    const tokenIds = JSON.parse(market.clobTokenIds) as string[];
    tokenIds.forEach(id => {
        outcomes[getOutcomeByAssetId(market, id)] = id;
    });

    return await race(new Promise(resolve => {
        let resolved = false;

        try {
            polyLiveDataClient.onWatchPriceChange(async (currentPrice, historyPriceList) => {
                if (!resolved) {
                    const distance = distanceToNextInterval(slugIntervalTimestamp);
                    if(distance<=0) {
                        resolved = true;
                        resolve(null);
                    }
                    
                    const { isDiffEnough, outcome, diffRatio, timeBasedRatio } = calcDiffBeatPrice(currentPrice.value, priceToBeat, globalConfig.stratgegy.diffBeatPriceFactor, distance);
                    const breakoutProbability = calcBreakoutProbabilityFromTicks(historyPriceList.slice(0, 30), distance, priceToBeat);
                    const { upBreakProbability, downBreakProbability } = breakoutProbability;
                    logData(`[价格检查] breakoutProbability: ${JSON.stringify({outcome, isDiffEnough,  diffRatio, timeBasedRatio, upBreakProbability, downBreakProbability})}`);

                    if (isDiffEnough) {

                      if(outcome === OUTCOMES_ENUM.Up && downBreakProbability >= globalConfig.stratgegy.breakProbabilityThreshold) {
                        // 存在翻盘可能
                        return
                      }
                      if(outcome === OUTCOMES_ENUM.Down && upBreakProbability >= globalConfig.stratgegy.breakProbabilityThreshold) {
                        // 存在翻盘可能
                        return
                      }

                        const data = await polyMarketDataClient.getLatestPriceChangeByAssetId(outcomes[outcome])
                        if(data) {
                            const { asks } = data;
                            const bestAsk = asks[asks.length - 1]?.price;
    
                            if (bestAsk && parseFloat(bestAsk) > globalConfig.stratgegy.bestAskThreshold) {
                                resolved = true;
                                resolve({
                                    tokenId: outcomes[outcome],
                                    bestAsk: bestAsk,
                                    outcome: outcome,
                                    orderbookSummary: data,
                                    cryptoPrice: currentPrice,
                                    priceToBeat,
                                    diffRatio,
                                    timeBasedRatio,
                                    upBreakProbability, 
                                    downBreakProbability
                                });
                            } else {
                                logInfo(`No best ask enough, bestAsk: ${bestAsk}, priceToBeat: ${priceToBeat}, cryptoPrice: ${currentPrice}, diffRatio: ${diffRatio}, timeBasedRatio: ${timeBasedRatio}`);
                            }
                        } else {
                            logInfo(`No data found for assetId: ${outcomes[outcome]}`);
                        }

                    }
                }
            })
        } catch (e) {
            logInfo(`findChanceByWatchPrice failed!`, e);
            resolved = true;
            resolve(null);
        }

    }), timeout)
}

export const monitorPriceChange = async (priceToBeat: number, outcome: string, timeout: number, slugIntervalTimestamp: number) => {
    const globalConfig = getGlobalConfig();
    const result = await race(new Promise(resolve => {
        polyLiveDataClient.onWatchPriceChange((currentPrice, historyPriceList) => {

          
            const currentOutCome = currentPrice.value - priceToBeat >= 0 ? OUTCOMES_ENUM.Up : OUTCOMES_ENUM.Down;
            if(currentOutCome !== outcome) {
                const distance = distanceToNextInterval(slugIntervalTimestamp);
                const breakoutProbability = calcBreakoutProbabilityFromTicks(historyPriceList.slice(0, 30), distance, priceToBeat);
                const { upBreakProbability, downBreakProbability } = breakoutProbability;
                logData(`[价格检查] breakoutProbability: ${JSON.stringify(breakoutProbability)}`);
                
                if(currentOutCome === OUTCOMES_ENUM.Up && downBreakProbability >= globalConfig.stratgegy.breakProbabilityThreshold) {
                  // 存在翻盘可能
                  return
                }
                if(currentOutCome === OUTCOMES_ENUM.Down && upBreakProbability >= globalConfig.stratgegy.breakProbabilityThreshold) {
                  // 存在翻盘可能
                  return
                }
                resolve(TOKEN_ACTION_ENUM.sell)
            }
        })
    }), timeout);

    if (result) {
        return result;
    }

    return TOKEN_ACTION_ENUM.won;
}

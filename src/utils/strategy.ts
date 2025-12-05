
import { MarketResponse } from "../module/gammaData";
import { logData, logInfo } from "../module/logger";
import { polyMarketDataClient } from "./polyMarketData";
import { race } from "./race";
import { TOKEN_ACTION_ENUM, distanceToNextInterval } from "./tools";
import { getGlobalConfig } from "./config";
import { polyLiveDataClient } from "./polyLiveData";
import { OUTCOMES_ENUM } from "./constans";
import { analyzeLastPeriodDecision, analyzePositionExitDecision, calcBreakoutProbabilityFromTicks, calcDiffBeatPrice } from "./calc";



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
                    if (distance <= 0) {
                        resolved = true;
                        resolve(null);
                    }

                    const diffBeatPriceResult = calcDiffBeatPrice(currentPrice.value, priceToBeat, globalConfig.stratgegy.diffBeatPriceFactor, distance);
                    const { isDiffEnough, outcome, diffRatio, timeBasedRatio } = diffBeatPriceResult;
                    logData(`[买入前价格检查] <diffBeatPriceResult>: ${JSON.stringify(diffBeatPriceResult)}`);
                    if (isDiffEnough) {
                        const analyzeResult = analyzeLastPeriodDecision({ ticks: historyPriceList, timeToExpiryMs: distance, priceToBeat: priceToBeat });
                        const { recommendation, } = analyzeResult;

                        logData(`[买入前价格检查] <analyzeResult>: ${JSON.stringify(analyzeResult)}`);
                        if (recommendation === null || recommendation != outcome) {
                            return
                        }

                        const data = await polyMarketDataClient.getLatestPriceChangeByAssetId(outcomes[outcome])
                        if (data) {
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
                                    timeBasedRatio
                                });
                            } else {
                                logInfo(`No best ask enough, bestAsk: ${bestAsk}, priceToBeat: ${priceToBeat}, cryptoPrice: ${currentPrice.value}, diffRatio: ${diffRatio}, timeBasedRatio: ${timeBasedRatio}`);
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

    }), timeout > 0 ? timeout : 0)
}

export const monitorPriceChange = async (priceToBeat: number, outcome: OUTCOMES_ENUM, timeout: number, slugIntervalTimestamp: number) => {
    const result = await race(new Promise(resolve => {
        let resolved = false;
        polyLiveDataClient.onWatchPriceChange((currentPrice, historyPriceList) => {
            if (resolved || distanceToNextInterval(slugIntervalTimestamp) <= 0) {
                return
            }
            const distance = distanceToNextInterval(slugIntervalTimestamp);
            const currentOutCome = currentPrice.value - priceToBeat >= 0 ? OUTCOMES_ENUM.Up : OUTCOMES_ENUM.Down;
            const analyzeResult = analyzePositionExitDecision({ ticks: historyPriceList, timeToExpiryMs: distance, priceToBeat: priceToBeat, positionOutcome: outcome });
            if (currentOutCome !== outcome) {
                logData(`[买入后价格检查(方向相反)] <analyzeResult>: ${JSON.stringify(analyzeResult)}`);
                resolve(analyzeResult.action)
            } else {
                logData(`[买入后价格检查(方向一致)] <analyzeResult>: ${JSON.stringify(analyzeResult)}`);
            }
        })
    }), timeout > 0 ? timeout : 0);

    if (result) {
        return result;
    }

    return TOKEN_ACTION_ENUM.hold;
}

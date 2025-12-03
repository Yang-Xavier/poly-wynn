
import { MarketResponse } from "../module/gammaData";
import { logData, logInfo } from "../module/logger";
import { polyMarketDataClient } from "./polyMarketData";
import { race } from "./race";
import { TOKEN_ACTION_ENUM, isGreaterThan90, calcDiffBeatPrice, distanceToNextInterval } from "./tools";
import { getGlobalConfig } from "./config";
import { polyLiveDataClient } from "./polyLiveData";
import { OUTCOMES_ENUM } from "./constans";

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
            polyLiveDataClient.onWatchPriceChange(async (currentPrice) => {
                if (!resolved) {
                    const distance = distanceToNextInterval(slugIntervalTimestamp);
                    if(distance<=0) {
                        resolved = true;
                        resolve(null);
                    }
                    
                    const { isDiffEnough, outcome, diffRatio, timeBasedRatio } = calcDiffBeatPrice(currentPrice, priceToBeat, globalConfig.stratgegy.diffBeatPriceFactor, distance);
                    if (isDiffEnough) {
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
                                    timeBasedRatio
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

export const findChanceByWatchOrderbook = async (market: MarketResponse, priceToBeat: number, timeout: number, slugIntervalTimestamp: number) => {
    const globalConfig = getGlobalConfig();

    return await race(new Promise(resolve => {
        try {
            let outcomes: { [key: string]: string } = {};
            let resolved = false;
            polyMarketDataClient.onWatchOrderBookPriceChange((data) => {
                if (!resolved) {
                    const { asset_id, asks } = data;
                    const bestAsk = asks[asks.length - 1]?.price;
                    if (!outcomes[asset_id]) {
                        outcomes[asset_id] = getOutcomeByAssetId(market, asset_id);
                    }

                    logData(`[Watch Orderbook] outcome: ${outcomes[asset_id]}, bestAsk: ${bestAsk}`);

                    if (isGreaterThan90(bestAsk)) {
                        const currentPrice = polyLiveDataClient.getLatestCryptoPricesFromChainLink();
                        const distance = distanceToNextInterval(slugIntervalTimestamp);
                        const { isDiffEnough, diffRatio, timeBasedRatio } = calcDiffBeatPrice(currentPrice, priceToBeat, globalConfig.stratgegy.diffBeatPriceFactor, distance);

                        if (isDiffEnough) {
                            resolved = true;
                            resolve({
                                tokenId: asset_id,
                                bestAsk: bestAsk,
                                outcome: outcomes[asset_id],
                                orderbookSummary: data,
                                cryptoPrice: currentPrice,
                                priceToBeat,
                                diffRatio,
                                timeBasedRatio
                            });
                        } else {
                            logInfo(`No diff beat price enough, bestAsk: ${bestAsk}, priceToBeat: ${priceToBeat}, cryptoPrice: ${currentPrice}, diffRatio: ${diffRatio}, timeBasedRatio: ${timeBasedRatio}`);
                        }
                    }
                }

            })
        } catch (e) {
            logInfo(`findChanceByWatchOrderbook failed!`, e);
            resolve(null);
        }

    }), timeout);
}


export const monitorPriceChange = async (priceToBeat: number, outcome: string, timeout: number) => {
    const result = await race(new Promise(resolve => {
        polyLiveDataClient.onWatchPriceChange((price) => {
            if (outcome === OUTCOMES_ENUM.Up) {
                if (price <= priceToBeat) {
                    resolve(TOKEN_ACTION_ENUM.sell)
                }
            } else if (outcome === OUTCOMES_ENUM.Down) {
                if (price >= priceToBeat) {
                    resolve(TOKEN_ACTION_ENUM.sell)
                }
            }
        })
    }), timeout);

    if (result) {
        return result;
    }

    return TOKEN_ACTION_ENUM.won;
}
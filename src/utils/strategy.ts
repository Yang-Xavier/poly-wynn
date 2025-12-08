
import { MarketResponse } from "../module/gammaData";
import { logData, logInfo } from "../module/logger";
import { polyMarketDataClient } from "./polyMarketData";
import { race } from "./race";
import { TOKEN_ACTION_ENUM, distanceToNextInterval } from "./tools";
import { getGlobalConfig } from "./config";
import { polyLiveDataClient } from "./polyLiveData";
import { OUTCOMES_ENUM } from "./constans";
import { analyzePositionExitDecision, calcDiffBeatPrice } from "./calc";
import { decideTailSweep } from "./decision";



const getOutcomeByAssetId = (market: MarketResponse, assetId: string) => {
    const { clobTokenIds, outcomes } = market;
    const tokenIds = JSON.parse(clobTokenIds) as string[];
    const index = tokenIds.findIndex(id => id === assetId);
    return JSON.parse(outcomes)[index] as string;
}

const getAssetIdMapOutcome = (market: MarketResponse) => {
    const outcomes: { [key: string]: string } = {};
    const tokenIds = JSON.parse(market.clobTokenIds) as string[];
    tokenIds.forEach(id => {
        outcomes[getOutcomeByAssetId(market, id)] = id;
    });
    return outcomes;
}

export const findChanceByWatchPrice = async (market: MarketResponse, priceToBeat: number, timeout: number, slugIntervalTimestamp: number) => {
    const globalConfig = getGlobalConfig();
    const outcomes = getAssetIdMapOutcome(market);

    return await race(new Promise(resolve => {
        let resolved = false;

        try {
            polyLiveDataClient.onWatchPriceChange((currentPrice, historyPriceList) => {
                try {
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
                            const upBestAsk = polyMarketDataClient.getBestAskByAssetId(outcomes[OUTCOMES_ENUM.Up]);
                            const downBestAsk = polyMarketDataClient.getBestAskByAssetId(outcomes[OUTCOMES_ENUM.Down]);
                            const tailSweepResult = decideTailSweep(
                                { ticks: historyPriceList, intervalStartPrice: priceToBeat, timeToExpiryMs: distance, upBestAsk, downBestAsk },
                                globalConfig.stratgegy.tailSweepConfig
                            );
                            logData(`[--扫尾盘数据策略数据--] <tailSweepResult>: ${JSON.stringify(tailSweepResult)}`);
                            if (tailSweepResult.shouldBet && upBestAsk && downBestAsk && tailSweepResult.impliedProbability >= globalConfig.stratgegy.bestAskThreshold) {
                                resolved = true;
                                resolve({
                                    tokenId: outcomes[outcome],
                                    bestAsk: tailSweepResult.side === OUTCOMES_ENUM.Up ? upBestAsk : downBestAsk,
                                    outcome: tailSweepResult.side,
                                    orderbookSummary: null,
                                    cryptoPrice: currentPrice,
                                    priceToBeat,
                                    diffRatio,
                                    timeBasedRatio
                                });
                            }
                        }
                    }
                } catch(e) {}
                
            })
        } catch (e) {
            logInfo(`findChanceByWatchPrice failed! ${e}`);
            resolved = true;
            resolve(null);
        }

    }), timeout > 0 ? timeout : 0)
}

export const monitorPriceChange = async (market: MarketResponse, priceToBeat: number, outcome: OUTCOMES_ENUM, timeout: number, slugIntervalTimestamp: number) => {
    const globalConfig = getGlobalConfig();
    const outcomes = getAssetIdMapOutcome(market);

    const result = await race(new Promise(resolve => {
        let resolved = false;
        polyLiveDataClient.onWatchPriceChange((currentPrice, historyPriceList) => {
            if (resolved || distanceToNextInterval(slugIntervalTimestamp) <= 0) {
                return
            }
            const currentOutCome = currentPrice.value - priceToBeat >= 0 ? OUTCOMES_ENUM.Up : OUTCOMES_ENUM.Down;
            const upBestAsk = polyMarketDataClient.getBestAskByAssetId(outcomes[OUTCOMES_ENUM.Up]);
            const downBestAsk = polyMarketDataClient.getBestAskByAssetId(outcomes[OUTCOMES_ENUM.Down]);
            const tailSweepResult = decideTailSweep(
                { ticks: historyPriceList, intervalStartPrice: priceToBeat, timeToExpiryMs: distanceToNextInterval(slugIntervalTimestamp), upBestAsk, downBestAsk },
                globalConfig.stratgegy.tailSweepConfig
            );

            if (currentOutCome !== outcome) {
                logData(`[买入后价格检查(方向相反)] outcoum: ${outcome}, currentOutCome: ${currentOutCome}, priceToBeat: ${priceToBeat}, currentPrice: ${currentPrice.value}, tailSweepResult: ${JSON.stringify(tailSweepResult)}`);
                resolved = true;
                resolve(TOKEN_ACTION_ENUM.sell);
            } else {
                logData(`[买入后价格检查(方向一致)] outcoum: ${outcome}, priceToBeat: ${priceToBeat}, currentPrice: ${currentPrice.value}, tailSweepResult: ${JSON.stringify(tailSweepResult)}`);
            }
        })
    }), timeout > 0 ? timeout : 0);

    if (result) {
        return result;
    }

    return TOKEN_ACTION_ENUM.hold;
}

import { getClobModule } from "../module/clob";
import { getGammaDataModule, MarketResponse } from "../module/gammaData";
import { logInfo } from "../module/logger";
import { polyMarketDataClient } from "./polyMarketData";
import { race } from "./race";
import { TOKEN_ACTION_ENUM, waitFor, isGreaterThan95, getAsksDepth, isDiffBeatPrice } from "./tools";
import { getGlobalConfig } from "./config";
import { polyLiveDataClient } from "./polyLiveData";

export const monitorPositionLoss = async ({
    tokenId,
    stopLoss,
    endTime,
    interval = 200,
}: {
    tokenId: string;
    stopLoss: number;
    endTime: number;
    interval?: number;
}) => {
    while (Date.now() < endTime * 1000) {
        // 获取orderbook信息
        logInfo(`[monitor] 获取orderbook信息，tokenId: ${tokenId}`);

        const orderbookSummary = await getClobModule().getOrderBookSummary(tokenId);
        if (orderbookSummary) {
            // 获取bestBids
            const bestPrices = getClobModule().getBestPrices(orderbookSummary);
            const bestBid = bestPrices?.bestBid;
            logInfo(`[monitor] tokenId: ${tokenId}, bestBid: ${bestBid}`);

            if (bestBid !== null && parseFloat(bestBid) <= stopLoss) {
                logInfo(`[monitor] bestBid ${bestBid} 低于阈值 ${stopLoss}`);
                // 你可以根据需求在此break，或继续轮询
                return TOKEN_ACTION_ENUM.sell
            }
        }
        // 等待200ms后再次轮询
        waitFor(interval);
    }
    logInfo(`[monitor] 轮训结束，已到达endTime，tokenId: ${tokenId}`);

    return TOKEN_ACTION_ENUM.won
}

export const findChance = async (market: MarketResponse) => {
    try {
        const gammaDataModule = getGammaDataModule();
        const clobModule = getClobModule();
        const clobTokens = gammaDataModule.getClobTokensBySlug(market);


        const [positiveToken, negativeToken] = clobTokens;


        const [orderBookSummaryPositive, orderBookSummaryNegative] = await Promise.all([
            clobModule.getOrderBookSummary(positiveToken.id),
            clobModule.getOrderBookSummary(negativeToken.id)
        ]);
        const [bestPricesPositive, bestPricesNegative] = [
            clobModule.getBestPrices(orderBookSummaryPositive),
            clobModule.getBestPrices(orderBookSummaryNegative)
        ];
        logInfo(`[findChance] bestPricesPositive: ${JSON.stringify(bestPricesPositive)}, bestPricesNegative: ${JSON.stringify(bestPricesNegative)}`);

        if (isGreaterThan95(bestPricesPositive?.bestAsk)) {
            const asksDepth = getAsksDepth(orderBookSummaryPositive);
            if (asksDepth.length > 0) {
                logInfo('[findChance] 机会存在，可以入场：', positiveToken.outcome);
                return {
                    tokenId: positiveToken.id,
                    orderbookSummary: orderBookSummaryPositive,
                    outcome: positiveToken.outcome
                }
            }
        } else if (isGreaterThan95(bestPricesNegative?.bestAsk)) {
            const asksDepth = getAsksDepth(orderBookSummaryNegative);
            if (asksDepth.length > 0) {
                logInfo('[findChance] 机会存在，可以入场：', negativeToken.outcome);
                return {
                    tokenId: negativeToken.id,
                    orderbookSummary: orderBookSummaryNegative,
                    outcome: negativeToken.outcome
                };
            }
        }
        logInfo('[findChance] 没有机会存在，不入场');
        return null;
    } catch (error) {
        logInfo('findChance failed!', error);
        return null;
    }

}

const getOutcomeByAssetId = (market: MarketResponse, assetId: string) => {
    const { clobTokenIds, outcomes } = market;
    const tokenIds = JSON.parse(clobTokenIds) as string[];
    const index = tokenIds.findIndex(id => id === assetId);
    return JSON.parse(outcomes)[index] as string;
}

export const findChanceByWatchOrderbook = async (market: MarketResponse, priceToBeat: number, timeout: number) => {
    const globalConfig = getGlobalConfig();
    return await race(new Promise(resolve => {
        let outcomes: { [key: string]: string } = {};
        polyMarketDataClient.onWatchOrderBookPriceChange((data) => {
            const { asset_id, asks } = data;
            const bestAsk = asks[asks.length - 1]?.price;
            if (!outcomes[asset_id]) {
                outcomes[asset_id] = getOutcomeByAssetId(market, asset_id);
            }

            logInfo(`watch orderbook, outcome: ${outcomes[asset_id]}, bestAsk: ${bestAsk}`);

            if (isGreaterThan95(bestAsk)) {
                if (isDiffBeatPrice(bestAsk, priceToBeat, globalConfig.stratgegy.diffBeatPriceFactor)) {
                    resolve({
                        tokenId: asset_id,
                        bestAsk: bestAsk,
                        outcome: outcomes[asset_id],
                        orderbookSummary: data,
                    });
                } else {
                    logInfo(`not diff beat price enough, bestAsk: ${bestAsk}, priceToBeat: ${priceToBeat}, diffBeatPriceFactor: ${globalConfig.stratgegy.diffBeatPriceFactor}`);

                }
            }
        })
    }), timeout);
}


export const monitorPriceChange = async (priceToBeat: number, outcome: string, timeout: number) => {
    const result =await race(new Promise(resolve => {
        polyLiveDataClient.onWatchPriceChange((price) => {
            if(outcome === "UP") {
                if(price <= priceToBeat) {
                    resolve(TOKEN_ACTION_ENUM.sell)
                }
            } else if(outcome === "DOWN") {
                if(price >= priceToBeat) {
                    resolve(TOKEN_ACTION_ENUM.sell)
                }
            }
        })
    }), timeout);
    
    if(result) {
        return result;
    }
    
    return TOKEN_ACTION_ENUM.won;
}
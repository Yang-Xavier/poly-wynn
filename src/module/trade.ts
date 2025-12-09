import { OrderType, Side } from "@polymarket/clob-client";
import { getClobModule, PolymarketOrderResult } from "./clob";
import { logError, logInfo } from "./logger";
import { distanceToNextInterval, waitFor } from "@utils/tools";
import { getGlobalConfig } from "@utils/config";
import { getGammaDataModule } from "./gammaData";



export const buy = async ({
    tokenId,
    amount,
    retryCount = 1,
    slugIntervalTimestamp
}: {
    tokenId: string,
    amount?: number,
    retryCount?: number,
    slugIntervalTimestamp: number
}
): Promise<PolymarketOrderResult | null> => {
    let result: PolymarketOrderResult | null = null;
    const clobModule = getClobModule();
    let count = retryCount;

    while (!result && count > 0 && distanceToNextInterval(slugIntervalTimestamp) > 0) {
        try {
            logInfo(`🙏尝试购买... 第${retryCount - count + 1} / ${retryCount} 次`)
            const { orderID } = await clobModule.postMarketOrder({
                tokenID: tokenId,
                amount,
                side: Side.BUY,
                orderType: OrderType.FAK
            });
            if (orderID) {
                await waitFor(1000);
                logInfo(`购买完成...`, { orderID })
                result = await clobModule.getOrder({
                    orderId: orderID
                });
            }
            logInfo(`购买结果: ${JSON.stringify(result || {})}`);
        } catch (e) {
            logInfo(`购买失败...${e}`)
        }
        count--
    }
    return result;
};


export const buyEnough = async ({
    tokenId,
    amount,
    slugIntervalTimestamp
}: {
    tokenId: string,
    amount: number,
    slugIntervalTimestamp: number
}): Promise<PolymarketOrderResult | null> => {
    const globalConfig = getGlobalConfig();
    const buyResults: PolymarketOrderResult[] = [];
    let buyCount = globalConfig.stratgegy.buyingMaxSplit;
    let remainAmount = amount;

    while (buyCount > 0 && distanceToNextInterval(slugIntervalTimestamp) > 0) {
        buyCount--;
        const buyResult = await buy({
            tokenId,
            amount: remainAmount,
            retryCount: globalConfig.stratgegy.buyingRetryCount,
            slugIntervalTimestamp
        });

        if (buyResult) {
            buyResults.push(buyResult);
            remainAmount = remainAmount - (Number(buyResult?.size_matched) * Number(buyResult?.price));
        }
        logInfo(`第 ${globalConfig.stratgegy.buyingMaxSplit - buyCount} / ${globalConfig.stratgegy.buyingMaxSplit} 笔购买完成, 本次购买: ${Number(buyResult?.size_matched) * Number(buyResult?.price)}, 购买额度: ${remainAmount}/${amount}`, buyResult);
        if (remainAmount <= 1 ) {
            break;
        }
    }

    const totalSizeMatched = buyResults.reduce((acc, curr) => acc + Number(curr.size_matched), 0);
    const totalPriceAmount = buyResults.reduce((acc, curr) => acc + Number(curr.price) * Number(curr.size_matched), 0);
    const avgPrice = totalPriceAmount / totalSizeMatched;
    const lastBuyResult = buyResults[buyResults.length - 1];

    if(lastBuyResult) {
        return Object.assign(lastBuyResult, {
            size_matched: totalSizeMatched,
            avgPrice: avgPrice,
        })
    }
    return null
}

export const mustSell = async ({
    tokenId,
    amount,
    slugIntervalTimestamp,
}: {
    tokenId: string,
    amount?: number,
    slugIntervalTimestamp?: number,
}
): Promise<PolymarketOrderResult | null> => {
    let result: PolymarketOrderResult | null = null;
    let count = 0;

    while (!result && distanceToNextInterval(slugIntervalTimestamp) > 0) {
        logInfo(`尝试卖出, 第 ${++count} 次...`)
        try {
            const clobModule = getClobModule();
            const { orderID } = await clobModule.postMarketOrder({
                tokenID: tokenId,
                amount,
                side: Side.SELL,
                orderType: OrderType.FAK
            });
            if (orderID) {
                await waitFor(1000);
                result = await clobModule.getOrder({
                    orderId: orderID
                });
            }
        } catch (e) {
            logInfo(`sell failed! ${e}`)
        }
    }

    return result;
};

export const sellExpired30MinPostions = async () => {
    const globalConfig = getGlobalConfig();
    const positions = await getGammaDataModule().getExpired30MinPositions({ funderAddress: globalConfig.account.funderAddress });
    if(positions.length === 0) {
        logInfo(`没有过期仓位需要卖出...`);
        return;
    }
    logInfo(`有 ${positions.length} 个过期仓位需要卖出...`);
    try {
        for (const position of positions) {
            await getClobModule().postOrder({
                tokenID: position.asset,
                size: Number(position.size),
                price: 0.99,
                side: Side.SELL,
                orderType: OrderType.FAK
            });
        }
    } catch (error) {
        logError(`过期仓位卖出失败: ${error}`);
    }

    logInfo(`过期仓位卖出完成...`);
}
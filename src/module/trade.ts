import { OrderType, Side } from "@polymarket/clob-client";
import { getClobModule,  PolymarketOrderResult } from "./clob";
import { logInfo } from "./logger";
import { distanceToNextInterval } from "@utils/tools";

export const buy = async ({
    tokenId,
    amount,
    retryCount = 1,
}: {
    tokenId: string,
    amount?: number,
    retryCount?: number,
}
): Promise<PolymarketOrderResult | null> => {
    let result: PolymarketOrderResult | null = null;
    const clobModule = getClobModule();
    let count = retryCount;

    while(!result && count > 0) {
        try {
            logInfo(`🙏尝试购买... 第${retryCount - count + 1} / ${retryCount} 次`)
            const { orderID } = await clobModule.postMarketOrder({
                tokenID: tokenId,
                amount,
                side: Side.BUY,
                orderType: OrderType.FAK
            });
            logInfo(`💡购买完成...`, { orderID })
            if (orderID) {
                result = await clobModule.getOrder({
                    orderId: orderID
                });
            }
        }catch(e) {
            logInfo(`购买失败...${e}`)
        }
        count--
    }
    return result;
};


export const sell = async ({
    tokenId,
    amount,
    mustSellInTheIvervalTimpstamp,
}: {
    tokenId: string,
    amount?: number,
    mustSellInTheIvervalTimpstamp?: number,
}
): Promise<PolymarketOrderResult | null> => {
    let result: PolymarketOrderResult | null = null;
    let count = 0;
    let distance = distanceToNextInterval(mustSellInTheIvervalTimpstamp);

    while(!result) {
        logInfo(`try to sell, ${count} times...`)
        try {
            const clobModule = getClobModule();
            const { orderID } = await clobModule.postMarketOrder({
                tokenID: tokenId,
                amount,
                side: Side.SELL,
                orderType: OrderType.FAK
            });
            if (orderID) {
                result = await clobModule.getOrder({
                    orderId: orderID
                });
            }
            // 如果没有必须在某个区间内卖出，则直接返回结果
            if(!mustSellInTheIvervalTimpstamp) {
                return result
            // 如果已经到达（或超过）指定的区间时间，则直接返回结果
            } else if(distance <= 0) {
                return result
            }
        } catch (e) {
            logInfo('sell failed!', e)
        }
        count++
        distance = distanceToNextInterval(mustSellInTheIvervalTimpstamp);
    }
    
    return result;
};
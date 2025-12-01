import { OrderType, Side } from "@polymarket/clob-client";
import { getClobModule,  OrderBookSummary, PolymarketOrderResult } from "./clob";
import { waitFor } from "@utils/tools";
import { logInfo } from "./logger";

export const buy = async ({
    tokenId,
    amount,
}: {
    tokenId: string,
    amount?: number,
}
): Promise<PolymarketOrderResult | null> => {
    let result: PolymarketOrderResult | null = null;
    const clobModule = getClobModule();
    const { orderID } = await clobModule.postMarketOrder({
        tokenID: tokenId,
        amount,
        side: Side.BUY,
        orderType: OrderType.FAK
    });
    if (orderID) {
        result = await clobModule.getOrder({
            orderId: orderID
        });
    }
    return result;
};


export const sell = async ({
    tokenId,
    amount,
    mustSell = false,
}: {
    tokenId: string,
    amount?: number,
    mustSell?: boolean,
}
): Promise<PolymarketOrderResult | null> => {
    let result: PolymarketOrderResult | null = null;
    let count = 0;

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
            if(!mustSell) {
                return result
            }
        } catch (e) {
            logInfo('sell failed!', e)
        }
        count++
    }
    
    return result;
};
import {
    getClobModule,
    PolymarketOrderResult,
} from "./module/clob";
import { buy, sell } from "./module/trade";
import {
    runIntervalFn,
    TOKEN_ACTION_ENUM,
    get15MinIntervalTimestamp,
    getMarketSlug15Min,
    runFnDelay,
    distanceToNextInterval,
    omit,
    calcPriceRange
} from "./utils/tools";
import {
    findChanceByWatchPrice,
    monitorPriceChange
} from './utils/strategy';
import { getRedeemModule } from "./module/redeem";
import { logError, logInfo, logTrade, setTraceId } from "./module/logger";
import { getGlobalConfig } from "@utils/config";
import { polyLiveDataClient } from "@utils/polyLiveData";
import { polyMarketDataClient } from "./utils/polyMarketData";
import { getGammaDataModule } from "./module/gammaData";
import { getPriceToBeat } from "@utils/polymarketApi";
import { getAccountBalance, logAccountBalance } from "@utils/account";


const init = async () => {
    const clobModule = getClobModule();
    try {
        await clobModule.init()
    } catch (e) {
        logInfo('clob initial failed!', e)
    }

}

export const runPolyWynn = async () => {
    await init();
    const globalConfig = getGlobalConfig();
    let buyCount = 0

    runIntervalFn(async (context: { setInterval: (ms: number) => void }) => {
        const slugIntervalTimestamp = get15MinIntervalTimestamp();
        const marketSlug = getMarketSlug15Min(globalConfig.marketTag, slugIntervalTimestamp);
        const distance = distanceToNextInterval(slugIntervalTimestamp);
        setTraceId(`${marketSlug}`);

        let positionAmount = globalConfig.stratgegy.buyingMaxAmount;
        try {
            const { formatted:balance } = await getAccountBalance(globalConfig.account.funderAddress, globalConfig.account.balanceTokenAddress);
            positionAmount = Math.min(globalConfig.stratgegy.buyingMaxAmount, Number(balance) * globalConfig.stratgegy.buyingAmountFactor);
            logInfo(`💰账户余额: ${balance}, 购买金额: ${positionAmount}`);
        }catch(e) {
            logInfo(`💰获取账户余额失败: ${e}, 购买金额: ${positionAmount}`);
        }

        if (distance > globalConfig.stratgegy.startBefore) {
            logInfo(`距离下一局开始还剩: ${(distance - globalConfig.stratgegy.startBefore) / 1000}s`)
            context.setInterval(distance - globalConfig.stratgegy.startBefore);
            buyCount = 0;
        } else {
            logInfo(`寻找机会...`);
            context.setInterval(globalConfig.stratgegy.findingChangeInterval);

            logInfo(`获取市场数据...`);
            const market = await getGammaDataModule().getMarketBySlug(marketSlug);
            const priceToBeat = await getPriceToBeat(globalConfig.marketTag, market.eventStartTime, market.endDate);
            logInfo(`对赌价格: ${priceToBeat}, market: ${marketSlug}`);

            logInfo(`订阅Crypto价格: ${globalConfig.marketTag}/usd`);
            await polyLiveDataClient.connect();
            await polyLiveDataClient.subscribeCryptoPrices(`${globalConfig.marketTag}/usd`);


            logInfo(`订阅市场数据: ${market.clobTokenIds}`);
            await polyMarketDataClient.connect();
            await polyMarketDataClient.subscribeMarket(JSON.parse(market.clobTokenIds) as string[]);

            const watchingOrderbookTimeout = distanceToNextInterval(slugIntervalTimestamp);
            const { conditionId } = market;
            logInfo(`查询是否存在订单，获取持仓订单: ${conditionId}`);
            const openOrders = await getClobModule().getOpenOrders(conditionId);
            const { upRange, downRange } = calcPriceRange(priceToBeat, globalConfig.stratgegy.diffBeatPriceFactor);

            let tokenChanceDetails: any = null;

            if (!openOrders || openOrders.length <= 0) {
                logInfo(`没有持仓订单`);
                logInfo(`🔍监控价格, 寻找机会... priceToBeat: ${priceToBeat}, timeout: ${watchingOrderbookTimeout}`);
                logInfo(`监控价格范围, Up: ${upRange.reverse().join(' -> ')} ||  Down: ${downRange.join(' -> ')}`);
                tokenChanceDetails = await findChanceByWatchPrice(market, priceToBeat, watchingOrderbookTimeout, slugIntervalTimestamp);
            }

            if (tokenChanceDetails || openOrders?.length > 0) {
                logInfo(`找到机会`, omit(tokenChanceDetails, ['orderbookSummary']));
                let boughtOrder: PolymarketOrderResult | null = null;
                try {
                    if (openOrders?.length > 0) {
                        logInfo(`已存在持仓订单, 跳过购买`, openOrders);
                        boughtOrder = openOrders[0];
                    } else {
                        logInfo(`准备购买...`, {
                            amount: positionAmount,
                            tokenId: tokenChanceDetails.tokenId,
                            cryptoPrice: tokenChanceDetails.cryptoPrice.value
                        });

                        boughtOrder = await buy({
                            amount: positionAmount,
                            tokenId: tokenChanceDetails.tokenId,
                            retryCount: globalConfig.stratgegy.buyingRetryCount
                        });

                        logInfo(`完成购买`, boughtOrder);
                    }
                } catch (error) {
                    logError(`购买失败: ${error}`);
                }

                if (boughtOrder && boughtOrder.status === 'MATCHED') {
                    // 购买成功
                    logTrade('buy', boughtOrder);
                    buyCount++;

                    const watchingPriceChangeTimeout = distanceToNextInterval(slugIntervalTimestamp);
                    logInfo(`监控价格变化, priceToBeat: ${priceToBeat}, currentPrice: ${tokenChanceDetails.cryptoPrice.value}, outcome: ${tokenChanceDetails.outcome}, timeout: ${watchingPriceChangeTimeout}`);
                    const action = await monitorPriceChange(priceToBeat, tokenChanceDetails.outcome, watchingPriceChangeTimeout, slugIntervalTimestamp);
                    const currentPrice = polyLiveDataClient.getLatestCryptoPricesFromChainLink();
                    logInfo(`👀监控仓位结果: ${action}, currentPrice: ${currentPrice}`);

                    logInfo(`断开与PolyLiveData的连接`);
                    await polyLiveDataClient.disconnect();
                    logInfo(`断开与PolyMarketData的连接`);
                    await polyMarketDataClient.disconnect();

                    if (action === TOKEN_ACTION_ENUM.sell) {
                        try {
                            const {
                                size_matched: boughtAmount
                            } = boughtOrder;

                            const sellResult = await sell({
                                amount: Number(boughtAmount),
                                tokenId: tokenChanceDetails.tokenId,
                                mustSellInTheIvervalTimpstamp: slugIntervalTimestamp
                            });
                            if (sellResult) {
                                logInfo(`卖出成功: ${JSON.stringify(sellResult)}`)
                                logTrade('sell', sellResult);
                            } else {
                                logInfo('卖出失败');
                                logTrade('lost', boughtOrder);
                            }
                        } catch (error) {
                            logError(`卖出失败: ${error}`);
                        }
                        await logAccountBalance();
                    } else {
                        logInfo(`等待赎回...${globalConfig.redeemConfig.delyRedeem / 1000}s`);
                        await runFnDelay(async () => {
                            try {
                                const { market: conditionId } = boughtOrder;
                                const redeemModule = getRedeemModule();
                                const { success } = await redeemModule.redeemViaAAWallet(conditionId);
                                if (success) {
                                    logInfo('赎回成功');
                                    logTrade('redeem', boughtOrder);
                                } else {
                                    logInfo('赎回失败');
                                }
                            } catch (error) {
                                logInfo('赎回失败', error);
                            }

                        }, globalConfig.redeemConfig.delyRedeem)
                        await logAccountBalance();
                    }
                }
            } else {
                logInfo(`🈚️没有找到机会, 跳过本局购买,等待下一轮开始...`);
            }
            logInfo(`确认断开ws连接...`);
            logInfo(`断开与PolyLiveData的连接`);
            await polyLiveDataClient.disconnect();
            logInfo(`断开与PolyMarketData的连接`);
            await polyMarketDataClient.disconnect();

            if(buyCount >= globalConfig.stratgegy.limitBuyCount) {
                context.setInterval(distanceToNextInterval(slugIntervalTimestamp));
                logInfo(`购买次数超过限制(${globalConfig.stratgegy.limitBuyCount})次, 跳过本局购买,等待下一轮开始...`);
            }
        }
    })
}
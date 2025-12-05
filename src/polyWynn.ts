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
    calcPriceRange,
    waitFor
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
import { OUTCOMES_ENUM } from "@utils/constans";


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

    runIntervalFn(async () => {
        let buyCount = 0
        const slugIntervalTimestamp = get15MinIntervalTimestamp();
        const marketSlug = getMarketSlug15Min(globalConfig.marketTag, slugIntervalTimestamp);
        setTraceId(`${marketSlug}`);

        let positionAmount = globalConfig.stratgegy.buyingMaxAmount / 2;
        try {
            const { formatted: balance } = await getAccountBalance(globalConfig.account.funderAddress, globalConfig.account.balanceTokenAddress);
            positionAmount = Math.min(globalConfig.stratgegy.buyingMaxAmount, Number(balance) * globalConfig.stratgegy.buyingAmountFactor);
            logInfo(`💰账户余额: ${balance}, 购买金额: ${positionAmount}`);

            logInfo(`获取市场数据...`);
            const market = await getGammaDataModule().getMarketBySlug(marketSlug);
            const priceToBeat = await getPriceToBeat(globalConfig.marketTag, market.eventStartTime, market.endDate);
            logInfo(`对赌价格: ${priceToBeat}, market: ${marketSlug}`);


            if (distanceToNextInterval(slugIntervalTimestamp) > globalConfig.stratgegy.startCollectDataBefore) {
                logInfo(`距离开始采集数据还剩: ${(distanceToNextInterval(slugIntervalTimestamp) - globalConfig.stratgegy.startCollectDataBefore) / 1000}s`)
                const waitTime = distanceToNextInterval(slugIntervalTimestamp) - globalConfig.stratgegy.startCollectDataBefore;
                await waitFor(waitTime > 0 ? waitTime : 0);
            }

            logInfo(`订阅Crypto价格: ${globalConfig.marketTag}/usd`);
            await polyLiveDataClient.connect();
            await polyLiveDataClient.subscribeCryptoPrices(`${globalConfig.marketTag}/usd`);

            logInfo(`订阅市场数据: ${market.clobTokenIds}`);
            await polyMarketDataClient.connect();
            await polyMarketDataClient.subscribeMarket(JSON.parse(market.clobTokenIds) as string[]);

            const toStartTime = distanceToNextInterval(slugIntervalTimestamp) - globalConfig.stratgegy.startBefore;
            if (toStartTime > 0) {
                logInfo(`距离开始策略还剩: ${(toStartTime) / 1000}s`)
                await waitFor(toStartTime);
            }

            logInfo(`查询是否存在订单，获取持仓订单: ${market.conditionId}`);
            const openOrders = await getGammaDataModule().getUserpostionByMarketAsOrder(market.conditionId, globalConfig.account.funderAddress);

            logInfo(`开始执行策略...`);
            let restartTimes = 0;
            let redeemOrder: PolymarketOrderResult | null = null;
            while (distanceToNextInterval(slugIntervalTimestamp) > 0) {
                try {
                    if (restartTimes > 0) {
                        logInfo(`策略重启次数: ${restartTimes}`);
                    }

                    const watchingOrderbookTimeout = distanceToNextInterval(slugIntervalTimestamp);
                    const { upRange, downRange } = calcPriceRange(priceToBeat, globalConfig.stratgegy.diffBeatPriceFactor);

                    let tokenChanceDetails: any = null;
                    let boughtOrder: PolymarketOrderResult | null = openOrders?.length > 0 ? openOrders[0] : null;

                    if (!boughtOrder) {
                        logInfo(`没有持仓订单`);
                        logInfo(`🔍监控价格, 寻找机会... priceToBeat: ${priceToBeat}, timeout: ${watchingOrderbookTimeout}`);
                        logInfo(`监控价格范围, Up: ${upRange.reverse().join(' -> ')} ||  Down: ${downRange.join(' -> ')}`);
                        tokenChanceDetails = await findChanceByWatchPrice(market, priceToBeat, watchingOrderbookTimeout, slugIntervalTimestamp);
                    } else {
                        logInfo(`已存在持仓订单, 跳过购买`, boughtOrder);
                    }

                    if (tokenChanceDetails) {
                        logInfo(`找到机会`, omit(tokenChanceDetails, ['orderbookSummary']));
                        logInfo(`准备购买...`, {
                            amount: positionAmount,
                            tokenId: tokenChanceDetails.tokenId,
                            cryptoPrice: tokenChanceDetails.cryptoPrice.value
                        });
                        try {
                            boughtOrder = await buy({
                                amount: positionAmount,
                                tokenId: tokenChanceDetails.tokenId,
                                retryCount: globalConfig.stratgegy.buyingRetryCount
                            });
                            logInfo(`完成购买`, boughtOrder);
                            boughtOrder && boughtOrder?.status === 'MATCHED' && buyCount++;
                        } catch (error) {
                            logError(`购买失败: ${error}`);
                        }
                    } else if (!boughtOrder) {
                        logInfo(`🈚️没有找到机会, 跳过本局购买,等待下一轮开始...`);
                    }

                    if (boughtOrder && boughtOrder.status === 'MATCHED') {
                        // 购买成功
                        logTrade('buy', boughtOrder);
                        const watchingPriceChangeTimeout = distanceToNextInterval(slugIntervalTimestamp);
                        const action = await monitorPriceChange(priceToBeat, boughtOrder.outcome as OUTCOMES_ENUM, watchingPriceChangeTimeout, slugIntervalTimestamp);
                        const currentPrice = polyLiveDataClient.getLatestCryptoPricesFromChainLink();
                        logInfo(`👀监控仓位结果: ${action}, priceToBeat: ${priceToBeat},currentPrice: ${currentPrice}, outcome: ${boughtOrder.outcome}, timeout: ${watchingPriceChangeTimeout}`);

                        if (action === TOKEN_ACTION_ENUM.sell) {
                            try {
                                const {
                                    size_matched: boughtAmount
                                } = boughtOrder;

                                const sellResult = await sell({
                                    amount: Number(boughtAmount),
                                    tokenId: boughtOrder.asset_id,
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
                            redeemOrder = boughtOrder
                        }
                    }

                    if (buyCount >= globalConfig.stratgegy.limitBuyCount) {
                        logInfo(`购买次数超过限制(${globalConfig.stratgegy.limitBuyCount})次, 跳过本局购买,等待下一轮开始...`);
                        await waitFor(distanceToNextInterval(slugIntervalTimestamp));
                    }
                } catch (error) {
                    logError(`策略执行失败: ${error}`);
                }

            }

            logInfo(`断开与PolyLiveData的连接`);
            await polyLiveDataClient.disconnect();
            logInfo(`断开与PolyMarketData的连接`);
            await polyMarketDataClient.disconnect();


            if (redeemOrder) {
                logInfo(`等待验证结果并赎回...${globalConfig.redeemConfig.delyRedeem / 1000}s`);
                await waitFor(globalConfig.redeemConfig.delyRedeem);
                try {
                    logInfo("验证结果...")
                    const finalMarket = await getGammaDataModule().getMarketBySlug(marketSlug);
                    const { outcomes, outcomePrices } = finalMarket;
                    const finalOutcomes = JSON.parse(outcomes) as string[];
                    const finalOutcomePrices = JSON.parse(outcomePrices).map(Number) as number[];
                    const outcomePrice = Math.max(...finalOutcomePrices);
                    const finalOutcome = finalOutcomes[finalOutcomePrices.findIndex(item => Number(item) === outcomePrice)];
                    logInfo(`对赌结果: ${redeemOrder.outcome === finalOutcome ? "🎉Won" : "💩Lost"}, 市场最终结果: ${finalOutcome}`);
                    if (finalOutcome === redeemOrder.outcome) {
                        const redeemModule = getRedeemModule();
                        const { success } = await redeemModule.redeemViaAAWallet(redeemOrder.market);
                        if (success) {
                            logInfo('赎回成功');
                            logTrade('redeem', redeemOrder);
                        } else {
                            logInfo('赎回失败');
                        }
                    } else {
                        logTrade('lost', redeemOrder);
                    }
                } catch (error) {
                    logInfo('赎回失败', error);
                }
            }

            await waitFor(30 * 1000)
            await logAccountBalance();

            logInfo(`本局结束...`);
        } catch (e) {
            logInfo(`${e}`);
        }
    })
}
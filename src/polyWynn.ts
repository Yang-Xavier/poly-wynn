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
    waitFor
} from "./utils/tools";
import {
    findChance,
    findChanceByWatchOrderbook,
    monitorPositionLoss,
    monitorPriceChange
} from './utils/strategy';
import { getRedeemModule } from "./module/redeem";
import { logError, logInfo, logTrade, setTraceId } from "./module/logger";
import { getGlobalConfig } from "@utils/config";
import { polyLiveDataClient } from "@utils/polyLiveData";
import { polyMarketDataClient } from "./utils/polyMarketData";
import { getGammaDataModule } from "./module/gammaData";
import { getPriceToBeat } from "@utils/polymarketApi";


const init = async () => {
    const globalConfig = getGlobalConfig();
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

    runIntervalFn(async (context: { setInterval: (ms: number) => void }) => {
        const slugIntervalTimestamp = get15MinIntervalTimestamp();
        const marketSlug = getMarketSlug15Min(globalConfig.marketTag, slugIntervalTimestamp);
        const distance = distanceToNextInterval(slugIntervalTimestamp);
        setTraceId(`${marketSlug}`);

        if (distance > globalConfig.stratgegy.startBefore) {
            logInfo(`本局距离开始执行策略还剩: ${(distance - globalConfig.stratgegy.startBefore) / 1000}s`)
            context.setInterval(distance - globalConfig.stratgegy.startBefore);
        } else {
            logInfo(`寻找机会...`);
            context.setInterval(globalConfig.stratgegy.findingChangeInterval);

            logInfo(`获取市场数据...`);
            const market = await getGammaDataModule().getMarketBySlug(marketSlug);
            const priceToBeat = await getPriceToBeat(globalConfig.marketTag, market.eventStartTime);
            logInfo(`价格 to beat: ${priceToBeat}`);

            logInfo(`订阅Crypto价格: ${globalConfig.polyData.cryptoPriceTag}`);
            await polyLiveDataClient.connect();
            await polyLiveDataClient.subscribeCryptoPrices(globalConfig.polyData.cryptoPriceTag);


            logInfo(`订阅市场数据: ${market.clobTokenIds}`);
            await polyMarketDataClient.connect();
            await polyMarketDataClient.subscribeMarket(JSON.parse(market.clobTokenIds) as string[]);

            const watchingOrderbookTimeout = distanceToNextInterval(slugIntervalTimestamp);
            logInfo(`find chance by watching orderbook, priceToBeat: ${priceToBeat}, timeout: ${watchingOrderbookTimeout}`);
            const tokenChanceDetails = await findChanceByWatchOrderbook(market, priceToBeat, watchingOrderbookTimeout);

            if (tokenChanceDetails) {
                logInfo(`找到机会: ${tokenChanceDetails.outcome}, bestAsk: ${tokenChanceDetails.bestAsk}, priceToBeat: ${priceToBeat}`);
                let buyResult: PolymarketOrderResult | null = null;
                try {
                    buyResult = await buy({
                        amount: globalConfig.positionAmount,
                        tokenId: tokenChanceDetails.tokenId
                    });
                    logInfo(`购买结果: ${JSON.stringify(buyResult)}`);
                } catch (error) {
                    logError(`购买失败: ${error}`);
                }

                if (buyResult && buyResult.status === 'MATCHED') {
                    logTrade('buy', buyResult);
                    const watchingPriceChangeTimeout = distanceToNextInterval(slugIntervalTimestamp);
                    logInfo(`监控价格变化, priceToBeat: ${priceToBeat}, outcome: ${tokenChanceDetails.outcome}, timeout: ${watchingPriceChangeTimeout}`);
                    const action = await monitorPriceChange(priceToBeat, tokenChanceDetails.outcome, watchingPriceChangeTimeout);
                    logInfo(`监控仓位结果: ${action}`);

                    if (action === TOKEN_ACTION_ENUM.sell) {
                        try {
                            const {
                                size_matched: boughtAmount
                            } = buyResult;

                            const sellResult = await sell({
                                amount: Number(boughtAmount),
                                tokenId: tokenChanceDetails.tokenId,
                                mustSell: true
                            });
                            if (sellResult) {
                                logInfo(`卖出成功: ${JSON.stringify(sellResult)}`)
                                logTrade('sell', sellResult);
                            } else {
                                logInfo('卖出失败');
                            }
                        } catch (error) {
                            logError(`卖出失败: ${error}`);
                        }
                    } else {
                        logInfo('等待赎回...');
                        await runFnDelay(async () => {
                            try {
                                const { market: conditionId } = buyResult;
                                const redeemModule = getRedeemModule();
                                const { success } = await redeemModule.redeemViaAAWallet(conditionId);
                                if (success) {
                                    logInfo('赎回成功');
                                    logTrade('redeem', buyResult);
                                } else {
                                    logInfo('赎回失败');
                                }
                            } catch (error) {
                                logInfo('赎回失败', error);
                            }

                        }, globalConfig.redeemConfig.delyRedeem)
                    }
                }

            } else {
                logInfo(`未找到机会`);
            }

            logInfo(`断开与PolyLiveData的连接`);
            await polyLiveDataClient.disconnect();
            logInfo(`断开与PolyMarketData的连接`);
            await polyMarketDataClient.disconnect();
        }
    })
}
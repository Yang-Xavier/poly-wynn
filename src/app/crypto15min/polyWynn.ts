import { getClobModule, PolymarketOrderResult } from "./module/clob";
import { buyEnough, mustSell } from "./module/trade";
import {
  runIntervalFn,
  TOKEN_ACTION_ENUM,
  get15MinIntervalTimestamp,
  getMarketSlug15Min,
  distanceToNextInterval,
  omit,
  waitFor,
} from "@crypto15min/utils/tools";
import { findChance, watchPosition } from "@crypto15min/utils/strategy";
import {
  getLoggerModule,
  logError,
  logInfo,
  setTraceId,
  logData,
  customTypeLog,
} from "./module/logger";
import { getGlobalConfig } from "@crypto15min/utils/config";
import { getGammaDataModule } from "./module/gammaData";
import { getPriceToBeat } from "@crypto15min/utils/getPriceToBeat";
import { getAccountBalance, logAccountBalance } from "@crypto15min/utils/account";
import { OUTCOMES_ENUM } from "@crypto15min/utils/constans";
import { destroyDataFlow, getDataFlowInstances, initializeDataFlow } from "./module/dataFlow";
import dataRecord from "./module/dataRecord";
import tradeReport from "./utils/tradeReport";
import { checkResultByPrice } from "./utils/checkResultByPrice";
import redeemTaskManager from "./utils/redeemTaskManager";
import { redeemAllPositions } from "./utils/relayerRedeem";

const init = async () => {
  const clobModule = getClobModule();
  try {
    await clobModule.init();
  } catch (e) {
    logInfo(`clob initial failed! ${e}`);
  }
};

export const runPolyWynn = async () => {
  await init();
  const globalConfig = getGlobalConfig();

  runIntervalFn(async () => {
    let buyCount = 0;
    const slugIntervalTimestamp = get15MinIntervalTimestamp();
    const marketSlug = getMarketSlug15Min(globalConfig.marketTag, slugIntervalTimestamp);
    setTraceId(marketSlug);
    dataRecord.setTraceId(marketSlug);
    tradeReport.setTraceId(marketSlug);

    logInfo(`初始化数据流...`);
    initializeDataFlow({
      logger: {
        logInfo,
        logError,
        logData,
        customTypeLog,
      },
      symbol: globalConfig.marketTag,
    });

    let positionAmount = globalConfig.stratgegy.buyingMaxAmount / 2;
    try {
      if (
        distanceToNextInterval(slugIntervalTimestamp) >
        globalConfig.stratgegy.startCollectDataBefore
      ) {
        logInfo(
          `距离开始采集数据还剩: ${(distanceToNextInterval(slugIntervalTimestamp) - globalConfig.stratgegy.startCollectDataBefore) / 1000}s`
        );
        const waitTime =
          distanceToNextInterval(slugIntervalTimestamp) -
          globalConfig.stratgegy.startCollectDataBefore;
        await waitFor(waitTime > 0 ? waitTime : 0);
      }

      logInfo(`订阅PolyCrypto价格: ${globalConfig.marketTag}/usd`);
      await getDataFlowInstances()?.polyPriceWs.connect();
      await getDataFlowInstances()?.polyPriceWs.subscribeCryptoPrices(
        `${globalConfig.marketTag}/usd`
      );
      logInfo(`订阅BN价格: ${globalConfig.marketTag}usdc`);
      await getDataFlowInstances()?.bnPriceWs.connect();

      logInfo(`获取市场数据...`);
      const market = await getGammaDataModule().getMarketBySlug(marketSlug);

      const waitTimeToGetPriceToBeat =
        distanceToNextInterval(slugIntervalTimestamp) -
        globalConfig.stratgegy.startGetPriceToBeatBefore;
      logInfo(`等待获取对赌价格还剩: ${waitTimeToGetPriceToBeat / 1000}s`);
      await waitFor(waitTimeToGetPriceToBeat > 0 ? waitTimeToGetPriceToBeat : 0);

      logInfo(`获取对赌价格...`);
      const priceToBeat = await getPriceToBeat(
        globalConfig.marketTag,
        market.eventStartTime,
        market.endDate
      );
      logInfo(`对赌价格: ${priceToBeat}, market: ${marketSlug}`);

      const toStartTime =
        distanceToNextInterval(slugIntervalTimestamp) - globalConfig.stratgegy.startBefore;
      if (toStartTime > 0) {
        logInfo(`距离开始策略还剩: ${toStartTime / 1000}s`);
        await waitFor(toStartTime);
      }

      logInfo(
        `==========策略开始========== 市场链接< https://polymarket.com/event/${marketSlug} >`
      );

      const { formatted: balance } = await getAccountBalance(
        globalConfig.account.funderAddress,
        globalConfig.account.balanceTokenAddress
      );

      positionAmount = Math.min(
        globalConfig.stratgegy.buyingMaxAmount,
        Number(balance) * globalConfig.stratgegy.buyingAmountFactor
      );

      logInfo(`💰账户余额: ${balance}, 购买金额: ${positionAmount}`);
      tradeReport.addReport("balance", {
        balance: Number(balance),
      });

      if (Number(balance) <= 1) {
        logInfo(`账户余额小于1, 跳过本局购买,等待下一轮开始...`);
        await waitFor(distanceToNextInterval(slugIntervalTimestamp));
      } else {
        logInfo(`订阅市场订单簿数据: ${market.clobTokenIds}`);
        await getDataFlowInstances()?.polyOrderBookWs.connect();
        await getDataFlowInstances()?.polyOrderBookWs.subscribeOrderBook(
          JSON.parse(market.clobTokenIds) as string[]
        );

        logInfo(`开始执行策略...`);
        let restartTimes = 0;
        let redeemOrder: PolymarketOrderResult | null = null;
        while (distanceToNextInterval(slugIntervalTimestamp) > 0) {
          try {
            if (restartTimes > 0) {
              logInfo(`策略重启次数: ${restartTimes}`);
            }

            const watchingOrderbookTimeout = distanceToNextInterval(slugIntervalTimestamp);

            logInfo(`查询是否存在订单，获取持仓订单: ${market.conditionId}`);
            const openOrders = await getGammaDataModule().getUserpostionByMarketAsOrder(
              market.conditionId,
              globalConfig.account.funderAddress
            );

            let tokenChanceDetails: any = null;
            let boughtOrder: PolymarketOrderResult | null =
              openOrders?.length > 0 ? openOrders[0] : null;

            if (!boughtOrder) {
              logInfo(`没有持仓订单`);
              logInfo(
                `🔍监控价格, 寻找机会... priceToBeat: ${priceToBeat}, timeout: ${watchingOrderbookTimeout}`
              );

              tokenChanceDetails = await findChance(
                market,
                priceToBeat,
                watchingOrderbookTimeout,
                slugIntervalTimestamp
              );
            } else {
              logInfo(`已存在持仓订单, 跳过购买`, boughtOrder);
            }

            if (tokenChanceDetails) {
              logInfo(`💡找到机会`, omit(tokenChanceDetails, ["orderbookSummary"]));
              logInfo(`准备购买...`, {
                balance,
                buyingAmountFactor: globalConfig.stratgegy.buyingAmountFactor,
                amount: positionAmount,
                tokenId: tokenChanceDetails.tokenId,
                cryptoPrice: tokenChanceDetails.cryptoPrice.value,
              });
              try {
                boughtOrder = await buyEnough({
                  amount: positionAmount,
                  tokenId: tokenChanceDetails.tokenId,
                  slugIntervalTimestamp,
                });
                logInfo(`完成购买`, boughtOrder);
              } catch (error) {
                logError(`购买失败: ${error}`);
              }
            } else if (!boughtOrder) {
              logInfo(`🈚️没有找到机会, 跳过本局购买,等待下一轮开始...`);
              tradeReport.addReport("result", {
                result: "skipped",
              });
              await waitFor(distanceToNextInterval(slugIntervalTimestamp));
            }

            if (boughtOrder && boughtOrder.status === "MATCHED") {
              buyCount += 1;
              // 购买成功
              if (tokenChanceDetails) {
                logInfo("buy", boughtOrder);
              }
              const watchingPriceChangeTimeout = distanceToNextInterval(slugIntervalTimestamp);
              let currentPrice = getDataFlowInstances()?.polyPriceWs.getLatestPriceData();
              logInfo(
                `👀监控仓位... priceToBeat: ${priceToBeat}, currentPrice: ${currentPrice?.value}, outcome: ${boughtOrder.outcome}, timeout: ${watchingPriceChangeTimeout}`
              );
              const action = await watchPosition(
                market,
                priceToBeat,
                boughtOrder.outcome as OUTCOMES_ENUM,
                watchingPriceChangeTimeout,
                slugIntervalTimestamp
              );
              currentPrice = getDataFlowInstances()?.polyPriceWs.getLatestPriceData();
              logInfo(
                `🤔监控仓位结果: ${action}, priceToBeat: ${priceToBeat}, currentPrice: ${currentPrice?.value}, outcome: ${boughtOrder.outcome}`
              );

              if (action === TOKEN_ACTION_ENUM.sell) {
                try {
                  const { size_matched: boughtAmount } = boughtOrder;

                  const sellResult = await mustSell({
                    amount: Number(boughtAmount),
                    tokenId: boughtOrder.asset_id,
                    slugIntervalTimestamp,
                  });
                  if (sellResult) {
                    logInfo(`卖出成功: ${JSON.stringify(sellResult)}`);
                    logInfo("sell", sellResult);
                    tradeReport.addReport("result", {
                      result: "sold",
                    });
                  } else {
                    logInfo("卖出失败");
                    logInfo("lost", boughtOrder);
                    tradeReport.addReport("result", {
                      result: "lost",
                    });
                  }
                } catch (error) {
                  logError(`卖出失败: ${error}`);
                }
                await logAccountBalance();
              } else {
                redeemOrder = boughtOrder;
              }
            }

            if (buyCount >= globalConfig.stratgegy.limitBuyCount && !redeemOrder) {
              logInfo(
                `购买次数超过限制(${globalConfig.stratgegy.limitBuyCount})次, 跳过本局购买,等待下一轮开始...`
              );
              await waitFor(distanceToNextInterval(slugIntervalTimestamp));
            }
          } catch (error) {
            logError(`策略执行失败: ${typeof error === "object" ? JSON.stringify(error) : error}`);
          }
          restartTimes++;
        }

        if (redeemOrder) {
          logInfo(`检查价格和最终结果...`);
          const { finalOutcome, finalPrice } = await checkResultByPrice(
            priceToBeat,
            getDataFlowInstances()?.polyPriceWs.getPriceHistory() ?? [],
            slugIntervalTimestamp
          );
          logInfo(
            `对赌结果: ${redeemOrder.outcome === finalOutcome ? "🎉Won" : "💩Lost"}, 价格结果: ${finalOutcome}, 最终价格: ${finalPrice}`
          );

          if (finalOutcome) {
            logInfo(`对赌结果: ${finalOutcome}`);
            const result = finalOutcome == redeemOrder.outcome ? "won" : "lost";
            tradeReport.addReport("result", {
              result,
              additionalInfo: result === "won" ? `Wait for Redeem` : "",
            });
            redeemTaskManager.addTask(marketSlug, market.conditionId, redeemOrder.outcome);
          }
        }
      }

      logInfo(`断开与PolyPriceWs的连接`);
      await getDataFlowInstances()?.polyPriceWs.disconnect();
      logInfo(`断开与BNPriceWs的连接`);
      await getDataFlowInstances()?.bnPriceWs.disconnect();
      logInfo(`断开与PolyOrderBookWs的连接`);
      await getDataFlowInstances()?.polyOrderBookWs.disconnect();

      if (redeemTaskManager.getTaskCount() === 1) {
        logInfo(`等待赎回仓位...${globalConfig.redeemConfig.delyRedeem / 1000}s`);
        await waitFor(globalConfig.redeemConfig.delyRedeem);
      }
      logInfo(`检查赎回仓位，进行赎回...`);
      await redeemTaskManager.runRedeem();

      logInfo(`检查历史仓位，进行赎回...`);
      // await redeemAllPositions({ funderAddress: globalConfig.account.funderAddress });

      logInfo(`本局结束...`);
    } catch (e) {
      logInfo(`策略执行失败: ${e}`);
      tradeReport.addReport("result", {
        result: "error",
      });
    }

    logInfo(`销毁数据流...`);
    destroyDataFlow();
    logInfo(`保存数据...`);
    dataRecord.saveToJson();
    dataRecord.close();

    logInfo(`清理日志/数据记录/交易报告...`);
    getLoggerModule().cleanOldLogs(7);
    dataRecord.cleanOldData(7);
    tradeReport.cleanOldReports(30);
  });
};

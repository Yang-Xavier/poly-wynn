import { BinancePriceWatcher, PriceData, WindowPriceChange } from "./watchBnPrice";
import { WatchOrderBook, OrderBookData, WindowOrderBookCallbackParams } from "./watchOrderBook";
import { PolymarketPriceWatcher } from "./watchPmPrice";
import { calculateBSM, PriceTick, BSMResult } from "./bsm";
import { logInfo, logError, setTraceId, logStrategy } from "./logger";
import { getPriceToBeat } from "@shared/api/polymarketApi";
import gammaApi from "@shared/api/gammaApi";
import {
  get15MinIntervalTimestamp,
  getMarketSlug15Min,
  distanceToNextInterval,
} from "@shared/marketUtils";
import { getGlobalConfig } from "@shared/config";
import { waitFor } from "@shared/utils/waitFor";

/**
 * 价格变化阈值（百分比），超过此阈值才触发BSM计算
 */
const PRICE_CHANGE_THRESHOLD: number = 0.15; // 0.5%的价格变化阈值

/**
 * 启动单局价差套利监控
 * @param slugIntervalTimestamp 当前局的区间时间戳
 * @returns 监控实例，用于断开连接
 */
async function startMonitoringRound(slugIntervalTimestamp: number): Promise<{
  bnWatcher: BinancePriceWatcher;
  pmWatcher: PolymarketPriceWatcher;
  orderBookWatcher: WatchOrderBook;
}> {
  const globalConfig = getGlobalConfig();
  const symbol = "eth"; // ETH市场
  const marketSlug = getMarketSlug15Min(symbol, slugIntervalTimestamp);
  setTraceId(marketSlug);

  logInfo(`[SpreadArbitrage] 准备启动监控，市场: ${marketSlug}`);

  // 1. 获取市场信息
  logInfo(`[SpreadArbitrage] 获取市场信息...`);
  const market = await gammaApi.getMarketBySlug(marketSlug);
  if (!market) {
    throw new Error(`无法获取市场信息: ${marketSlug}`);
  }

  // 解析clobTokenIds和outcomes
  const clobTokenIds = JSON.parse(market.clobTokenIds || "[]") as string[];
  const outcomes = JSON.parse(market.outcomes || "[]") as string[];

  if (clobTokenIds.length < 2 || outcomes.length < 2) {
    throw new Error("市场数据不完整：clobTokenIds或outcomes不足");
  }

  // 确定up和down的assetId（通常第一个是up，第二个是down，或者根据outcomes判断）
  let upAssetId: string;
  let downAssetId: string;

  // 根据outcomes判断（通常包含"Up"和"Down"）
  if (outcomes[0].toLowerCase().includes("up")) {
    upAssetId = clobTokenIds[0];
    downAssetId = clobTokenIds[1];
  } else if (outcomes[1].toLowerCase().includes("up")) {
    upAssetId = clobTokenIds[1];
    downAssetId = clobTokenIds[0];
  } else {
    // 默认第一个是up，第二个是down
    upAssetId = clobTokenIds[0];
    downAssetId = clobTokenIds[1];
    logInfo(`[SpreadArbitrage] 无法从outcomes判断方向，使用默认顺序`);
  }

  logInfo(
    `[SpreadArbitrage] 市场信息: Up资产ID=${upAssetId}, Down资产ID=${downAssetId}, outcomes=${outcomes.join(",")}`
  );

  // 2. 获取对赌价格
  logInfo(`[SpreadArbitrage] 获取对赌价格...`);
  if (!market.eventStartTime || !market.endDate) {
    throw new Error("市场缺少eventStartTime或endDate");
  }
  const priceToBeat = await getPriceToBeat(symbol, market.eventStartTime, market.endDate);
  logInfo(`[SpreadArbitrage] 对赌价格: ${priceToBeat}`);

  // 3. 创建监控实例
  const bnWatcher = new BinancePriceWatcher(`${symbol}usdt`, {
    logger: {
      logInfo: (msg: string, data?: any) => logInfo(`[BN] ${msg}`, data),
      logError: (msg: string, error?: any) => logError(`[BN] ${msg}`, error),
      logData: (msg: string, data?: any) => logInfo(`[BN] ${msg}`, data),
    },
  });
  const pmWatcher = new PolymarketPriceWatcher({
    logger: {
      logInfo: (msg: string, data?: any) => logInfo(`[PM] ${msg}`, data),
      logError: (msg: string, error?: any) => logError(`[PM] ${msg}`, error),
      logData: (msg: string, data?: any) => logInfo(`[PM] ${msg}`, data),
    },
  });
  const orderBookWatcher = new WatchOrderBook({
    logger: {
      logInfo: (msg: string, data?: any) => logInfo(`[OB] ${msg}`, data),
      logError: (msg: string, error?: any) => logError(`[OB] ${msg}`, error),
      logData: (msg: string, data?: any) => logInfo(`[OB] ${msg}`, data),
    },
  });

  // 4. 连接并订阅
  logInfo(`[SpreadArbitrage] 连接币安WebSocket...`);
  await bnWatcher.connect();

  logInfo(`[SpreadArbitrage] 连接Polymarket价格WebSocket...`);
  await pmWatcher.connect();
  pmWatcher.subscribeCryptoPrices(`${symbol}/usd`);

  logInfo(`[SpreadArbitrage] 连接Polymarket订单簿WebSocket...`);
  await orderBookWatcher.connect();
  orderBookWatcher.subscribeMarket(clobTokenIds);

  // 状态变量
  let firstWindowDelta: number | null = null; // 第一个窗口的delta（Bn价格 - PM价格）
  let firstWindowCompleted = false;
  let previousBnPrice: number | null = null;
  let previousPmPrice: number | null = null;

  // 5. 设置PM价格窗口回调（用于计算第一个窗口的delta）
  pmWatcher.setWindowCallback((change: WindowPriceChange) => {
    if (!firstWindowCompleted && change.currentPrice > 0) {
      const bnLatest = bnWatcher.getLatestPrice();
      if (bnLatest && bnLatest.price > 0) {
        // 计算第一个窗口的delta
        firstWindowDelta = bnLatest.price - change.currentPrice;
        firstWindowCompleted = true;
        logInfo(
          `[SpreadArbitrage] 第一个窗口完成，Delta=${firstWindowDelta.toFixed(2)} (Bn=${bnLatest.price.toFixed(2)}, PM=${change.currentPrice.toFixed(2)})`
        );
      }
    }
    previousPmPrice = change.currentPrice;
  });

  // 6. 设置订单簿窗口回调（用于获取最新报价）
  let latestOrderBook: OrderBookData | null = null;
  orderBookWatcher.setWindowCallback((params: WindowOrderBookCallbackParams) => {
    latestOrderBook = params.orderBook;
  });

  // 7. 设置Bn价格窗口回调（核心逻辑）
  bnWatcher.setWindowCallback((change: WindowPriceChange) => {
    try {
      // 等待第一个窗口完成
      if (!firstWindowCompleted || firstWindowDelta === null) {
        return;
      }

      // 获取PM最新价格
      const pmLatest = pmWatcher.getLatestPrice();
      if (!pmLatest || pmLatest.price <= 0) {
        return;
      }

      // 计算Bn价格变化百分比
      const bnPriceChangePercent =
        previousBnPrice !== null && previousBnPrice > 0
          ? Math.abs((change.currentPrice - previousBnPrice) / previousBnPrice) * 100
          : 0;

      // 计算PM价格变化百分比
      const pmPriceChangePercent =
        previousPmPrice !== null && previousPmPrice > 0
          ? Math.abs((pmLatest.price - previousPmPrice) / previousPmPrice) * 100
          : 0;

      // 如果Bn价格变化超过阈值，触发BSM计算
      if (bnPriceChangePercent >= PRICE_CHANGE_THRESHOLD) {
        logInfo(
          `[SpreadArbitrage] Bn价格变化触发: ${bnPriceChangePercent.toFixed(2)}% (当前=${change.currentPrice.toFixed(2)}, 上一个=${previousBnPrice?.toFixed(2)})`
        );

        // 获取Bn历史价格缓存
        const bnHistory = bnWatcher.getCachedData();
        if (bnHistory.length < 2) {
          logInfo(`[SpreadArbitrage] Bn历史数据不足，跳过BSM计算`);
          return;
        }

        // 将Bn历史价格转换为PriceTick格式，并减去delta
        const adjustedHistory: PriceTick[] = bnHistory.map((tick) => ({
          price: tick.price - firstWindowDelta, // 减去delta得到调整后的价格
          timestamp: tick.timestamp,
        }));

        const timeToExpiryMs = distanceToNextInterval(slugIntervalTimestamp);
        if (timeToExpiryMs <= 0) {
          logInfo(`[SpreadArbitrage] 市场已结算，跳过BSM计算`);
          return;
        }

        // 调用BSM模型计算概率
        const bsmResult: BSMResult = calculateBSM(
          adjustedHistory,
          priceToBeat,
          timeToExpiryMs,
          0, // 无风险利率设为0
          0 // 使用全部历史数据
        );

        logInfo(
          `[SpreadArbitrage] BSM计算结果: Up概率=${(bsmResult.probUp * 100).toFixed(2)}%, Down概率=${(bsmResult.probDown * 100).toFixed(2)}%, 置信度=${(bsmResult.confidence * 100).toFixed(2)}%`
        );

        // 获取订单簿最新报价
        if (latestOrderBook) {
          const upAssetData = latestOrderBook[upAssetId] as
            | { bestAsk: number; bestBid: number }
            | undefined;
          const downAssetData = latestOrderBook[downAssetId] as
            | { bestAsk: number; bestBid: number }
            | undefined;

          if (upAssetData && downAssetData) {
            const upBestAsk = upAssetData.bestAsk;
            const downBestAsk = downAssetData.bestAsk;

            // 计算价差（订单簿价格与BSM概率的差异）
            const upPriceDiff = (upBestAsk - bsmResult.probUp) * 100; // 转换为百分比
            const downPriceDiff = (downBestAsk - bsmResult.probDown) * 100;

            // 打印对比结果
            logStrategy(
              `[SpreadArbitrage] 订单簿 vs BSM模型对比:\n` +
                `  Up:   订单簿价格=${(upBestAsk * 100).toFixed(2)}%, BSM概率=${(bsmResult.probUp * 100).toFixed(2)}%, 价差=${upPriceDiff.toFixed(2)}%\n` +
                `  Down: 订单簿价格=${(downBestAsk * 100).toFixed(2)}%, BSM概率=${(bsmResult.probDown * 100).toFixed(2)}%, 价差=${downPriceDiff.toFixed(2)}%\n` +
                `  Bn价格=${change.currentPrice.toFixed(2)}, PM价格=${pmLatest.price.toFixed(2)}, Delta=${firstWindowDelta.toFixed(2)}\n` +
                `  剩余时间=${(timeToExpiryMs / 60000).toFixed(1)}分钟, 置信度=${(bsmResult.confidence * 100).toFixed(2)}%`
            );
          } else {
            logInfo(`[SpreadArbitrage] 订单簿数据不完整，无法对比`);
          }
        } else {
          logInfo(`[SpreadArbitrage] 订单簿数据尚未就绪`);
        }
      }

      // 更新上一个价格
      previousBnPrice = change.currentPrice;
    } catch (error) {
      logError(`[SpreadArbitrage] 处理Bn价格回调时出错: ${error}`);
    }
  });

  logInfo(`[SpreadArbitrage] 监控已成功启动`);

  // 返回监控实例
  return {
    bnWatcher,
    pmWatcher,
    orderBookWatcher,
  };
}

/**
 * 主循环：持续监控每一局
 */
async function runContinuousMonitoring(): Promise<void> {
  // 处理进程退出信号，优雅关闭
  let currentWatchers: {
    bnWatcher: BinancePriceWatcher;
    pmWatcher: PolymarketPriceWatcher;
    orderBookWatcher: WatchOrderBook;
  } | null = null;

  const cleanup = () => {
    if (currentWatchers) {
      logInfo("[SpreadArbitrage] 正在断开连接...");
      currentWatchers.bnWatcher.disconnect();
      currentWatchers.pmWatcher.disconnect();
      currentWatchers.orderBookWatcher.disconnect();
      currentWatchers = null;
    }
  };

  process.on("SIGINT", () => {
    logInfo("[SpreadArbitrage] 收到 SIGINT 信号，正在停止监控...");
    cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    logInfo("[SpreadArbitrage] 收到 SIGTERM 信号，正在停止监控...");
    cleanup();
    process.exit(0);
  });

  // 主循环
  while (true) {
    const symbol = "eth";
    const slugIntervalTimestamp = get15MinIntervalTimestamp();
    const marketSlug = getMarketSlug15Min(symbol, slugIntervalTimestamp);
    setTraceId(marketSlug);
    logInfo(`[SpreadArbitrage] ==========开始新的一局监控========== 市场: ${marketSlug}`);

    try {
      // 启动当前局的监控
      currentWatchers = await startMonitoringRound(slugIntervalTimestamp);

      // 等待当前局结束（监控直到距离下一局的时间为0）
      let lastDistance = distanceToNextInterval(slugIntervalTimestamp);
      const checkInterval = 1000 * 30; // 每30秒检查一次
      let lastLogTime = 0; // 上次打印日志的时间（秒）

      while (lastDistance > 0) {
        await waitFor(checkInterval);
        lastDistance = distanceToNextInterval(slugIntervalTimestamp);
        const remainingSeconds = Math.floor(lastDistance / 1000);

        // 每10秒打印一次剩余时间
        if (
          remainingSeconds > 0 &&
          remainingSeconds % 30 === 0 &&
          remainingSeconds !== lastLogTime
        ) {
          logInfo(`[SpreadArbitrage] 当前局剩余时间: ${remainingSeconds}秒`);
          lastLogTime = remainingSeconds;
        }
      }

      logInfo(`[SpreadArbitrage] 当前局已结束，准备进入下一局...`);

      // 断开当前局的连接
      cleanup();

      // 等待下一局开始（等待一小段时间确保市场数据准备好）
      const waitTime = 2000; // 等待2秒
      logInfo(`[SpreadArbitrage] 等待 ${waitTime / 1000} 秒后进入下一局...`);
      await waitFor(waitTime);
    } catch (error) {
      logError(`[SpreadArbitrage] 监控过程中出错: ${error}`);
      cleanup();

      // 出错后等待一段时间再重试
      logInfo(`[SpreadArbitrage] 5秒后重试...`);
      await waitFor(distanceToNextInterval(slugIntervalTimestamp));
    }
  }
}

// 启动持续监控循环
runContinuousMonitoring();

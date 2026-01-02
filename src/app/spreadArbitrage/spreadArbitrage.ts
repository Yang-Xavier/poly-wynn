/**
 * 价差套利模块
 * 监控订单簿价格变化，检测价格波动并触发交易信号
 */
import { get15MinIntervalTimestamp, getMarketSlug15Min } from "@shared/marketUtils";
import { logInfo, logError, logChance, setTraceId } from "./logger";
import { createSpreadArbitrageMonitor, PriceChangeSignal } from "./SpreadArbitrageMonitor";
import gammaApi from "@shared/api/gammaApi";

// 时间窗口大小（x ms，变量占位，等待传入）
const WINDOW_SIZE_MS: number = 500; // TODO: 设置时间窗口大小（毫秒）

// 价格变化阈值（x%，变量占位，等待传入）
const PRICE_CHANGE_THRESHOLD: number = 17; // TODO: 设置价格变化阈值（百分比，例如 5 表示 5%）

/**
 * 价格变化回调函数（占位函数，等待实现）
 * @param signal 价格变化信号，包含 yes 和 no 资产的价格以及订单簿深度
 */
function handlePriceChange(signal: PriceChangeSignal): void {
  logChance(
    `[SpreadArbitrage] 收到价格变化信号: ` +
      `资产 ${signal.yesAssetId} 价格 ${signal.yesPrice}, ` +
      `资产 ${signal.noAssetId} 价格 ${signal.noPrice}, ` +
      `价格变化: ${signal.priceChangePercent.toFixed(2)}%, ` +
      `时间窗口: ${new Date(signal.windowStart).toISOString()} - ${new Date(signal.windowEnd).toISOString()}`
  );

  // TODO: 在这里实现你的交易逻辑
  // 例如：根据价格变化执行套利交易
  // 可以访问 signal.yesOrderBook 和 signal.noOrderBook 获取完整的订单簿深度
  // signal.yesOrderBook.asks - yes 资产的卖单深度
  // signal.yesOrderBook.bids - yes 资产的买单深度
  // signal.noOrderBook.asks - no 资产的卖单深度
  // signal.noOrderBook.bids - no 资产的买单深度
}

// ============ 启动监控 ============

/**
 * 启动价差套利监控
 */
async function startMonitoring(): Promise<void> {
  const slugIntervalTimestamp = get15MinIntervalTimestamp();
  const marketSlug = getMarketSlug15Min("btc", slugIntervalTimestamp);
  setTraceId(marketSlug);

  try {
    const market = await gammaApi.getMarketBySlug(marketSlug);
    const { clobTokenIds: clobTokenIdsString } = market;
    const clobTokenIds = JSON.parse(clobTokenIdsString) as string[];
    logInfo(
      `[SpreadArbitrage] 准备启动监控，配置: ` +
        `资产ID: ${clobTokenIdsString}, ` +
        `窗口大小: ${WINDOW_SIZE_MS}ms, ` +
        `价格变化阈值: ${PRICE_CHANGE_THRESHOLD}%`
    );

    const monitor = createSpreadArbitrageMonitor({
      windowSize: WINDOW_SIZE_MS,
      priceChangeThreshold: PRICE_CHANGE_THRESHOLD,
      onPriceChange: handlePriceChange,
    });

    await monitor.start(clobTokenIds);

    logInfo("[SpreadArbitrage] 监控已成功启动");

    // 处理进程退出信号，优雅关闭
    process.on("SIGINT", () => {
      logInfo("[SpreadArbitrage] 收到 SIGINT 信号，正在停止监控...");
      monitor.stop();
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      logInfo("[SpreadArbitrage] 收到 SIGTERM 信号，正在停止监控...");
      monitor.stop();
      process.exit(0);
    });
  } catch (error) {
    logError(`[SpreadArbitrage] 启动监控失败: ${error}`);
    process.exit(1);
  }
}

startMonitoring();

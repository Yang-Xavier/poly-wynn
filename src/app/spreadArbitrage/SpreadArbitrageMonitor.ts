import { PolyMarketDataClient } from "@shared/ws/PolyMarketData";
import { logInfo, logError, logData } from "./logger";
import { IMarketPushData } from "@typings/wsData";

// 时间窗口价格记录接口
interface WindowPriceRecord {
  windowStart: number; // 窗口开始时间戳
  windowEnd: number; // 窗口结束时间戳
  prices: {
    [assetId: string]: number | null; // 该窗口内每个资产的最后 bestAsk 价格
  };
  orderBooks: {
    [assetId: string]: IMarketPushData | null; // 该窗口内每个资产的最新订单簿数据
  };
}

// 占位函数参数接口
export interface PriceChangeSignal {
  yesAssetId: string;
  noAssetId: string;
  yesPrice: number;
  noPrice: number;
  yesOrderBook: IMarketPushData;
  noOrderBook: IMarketPushData;
  priceChangePercent: number;
  windowStart: number;
  windowEnd: number;
}

/**
 * 价差套利监控类
 */
export class SpreadArbitrageMonitor {
  private client: PolyMarketDataClient;
  private windowSize: number; // 时间窗口大小（毫秒）
  private priceChangeThreshold: number; // 价格变化阈值（百分比，例如 5 表示 5%）
  private currentWindow: WindowPriceRecord | null = null;
  private previousWindow: WindowPriceRecord | null = null;
  private windowTimer: NodeJS.Timeout | null = null;
  private subscribedAssetIds: string[] = [];
  private onPriceChangeCallback?: (signal: PriceChangeSignal) => void;

  constructor({
    windowSize,
    priceChangeThreshold,
    onPriceChange,
  }: {
    windowSize: number; // 时间窗口大小（毫秒）
    priceChangeThreshold: number; // 价格变化阈值（百分比）
    onPriceChange?: (signal: PriceChangeSignal) => void; // 价格变化回调函数
  }) {
    this.client = new PolyMarketDataClient({
      logger: {
        logInfo,
        logData,
        logError,
      },
    });
    this.windowSize = windowSize;
    this.priceChangeThreshold = priceChangeThreshold;
    this.onPriceChangeCallback = onPriceChange;
  }

  /**
   * 启动监控
   * @param assetIds 资产ID数组，应该包含 yes 和 no 两个资产的ID
   */
  async start(assetIds: string[]): Promise<void> {
    if (!Array.isArray(assetIds) || assetIds.length === 0) {
      throw new Error("资产ID数组不能为空");
    }

    this.subscribedAssetIds = assetIds;

    // 连接 WebSocket
    await this.client.connect();

    // 订阅市场数据
    this.client.subscribeMarket(assetIds);

    // 注册价格变化回调
    this.client.onWatchOrderBookPriceChange((data: IMarketPushData) => {
      this.handleOrderBookUpdate(data);
    });

    // 启动时间窗口定时器
    this.startWindowTimer();

    logInfo(
      `[SpreadArbitrage] 监控已启动，资产: ${assetIds.join(", ")}, 窗口大小: ${this.windowSize}ms, 价格变化阈值: ${this.priceChangeThreshold}%`
    );
  }

  /**
   * 处理订单簿更新
   */
  private handleOrderBookUpdate(data: IMarketPushData): void {
    if (!this.subscribedAssetIds.includes(data.asset_id)) {
      return;
    }

    // 从订单簿数据中提取 bestAsk 价格（asks 数组的最后一个元素是最优卖价）
    const asks = data.asks;
    if (!asks || asks.length === 0) {
      return;
    }
    const bestAsk = Number(asks[asks.length - 1]?.price);

    if (isNaN(bestAsk)) {
      return;
    }

    // 如果当前窗口不存在，创建一个新窗口
    if (!this.currentWindow) {
      this.currentWindow = {
        windowStart: Date.now(),
        windowEnd: Date.now() + this.windowSize,
        prices: {},
        orderBooks: {},
      };
    }

    // 更新当前窗口的价格和订单簿数据（使用最新的数据）
    this.currentWindow.prices[data.asset_id] = bestAsk;
    this.currentWindow.orderBooks[data.asset_id] = data;
  }

  /**
   * 启动时间窗口定时器
   */
  private startWindowTimer(): void {
    const tick = () => {
      this.processWindow();
      this.windowTimer = setTimeout(tick, this.windowSize);
    };

    // 立即开始第一个窗口
    this.currentWindow = {
      windowStart: Date.now(),
      windowEnd: Date.now() + this.windowSize,
      prices: {},
      orderBooks: {},
    };

    this.windowTimer = setTimeout(tick, this.windowSize);
  }

  /**
   * 处理时间窗口
   */
  private processWindow(): void {
    if (!this.currentWindow) {
      return;
    }

    // 窗口结束，进行价格比较
    this.currentWindow.windowEnd = Date.now();

    // 如果有上一个窗口，进行价格变化检测
    if (this.previousWindow) {
      this.checkPriceChange(this.previousWindow, this.currentWindow);
    }

    // 将当前窗口保存为上一个窗口，并创建新窗口
    this.previousWindow = this.currentWindow;
    this.currentWindow = {
      windowStart: Date.now(),
      windowEnd: Date.now() + this.windowSize,
      prices: {},
      orderBooks: {},
    };
  }

  /**
   * 检查价格变化
   */
  private checkPriceChange(
    previousWindow: WindowPriceRecord,
    currentWindow: WindowPriceRecord
  ): void {
    // 遍历所有资产，检查价格变化
    for (const assetId of this.subscribedAssetIds) {
      const previousPrice = previousWindow.prices[assetId];
      const currentPrice = currentWindow.prices[assetId];

      // 如果价格数据不完整，跳过
      if (
        previousPrice === null ||
        previousPrice === undefined ||
        currentPrice === null ||
        currentPrice === undefined
      ) {
        continue;
      }

      // 计算价格变化百分比
      const priceChangePercent = ((currentPrice - previousPrice) / previousPrice) * 100;
      const absPriceChangePercent = Math.abs(priceChangePercent);

      // 如果价格变化超过阈值，触发回调
      if (absPriceChangePercent >= this.priceChangeThreshold) {
        // 查找对应的另一个资产（假设是 yes/no 配对）
        const otherAssetIds = this.subscribedAssetIds.filter((id) => id !== assetId);

        for (const otherAssetId of otherAssetIds) {
          const otherCurrentPrice = currentWindow.prices[otherAssetId];
          if (otherCurrentPrice === null || otherCurrentPrice === undefined) {
            continue;
          }

          // 从窗口记录中获取订单簿数据
          const currentOrderBook = currentWindow.orderBooks[assetId];
          const otherOrderBook = currentWindow.orderBooks[otherAssetId];

          if (!currentOrderBook || !otherOrderBook) {
            continue;
          }

          // 调用占位函数
          if (this.onPriceChangeCallback) {
            this.onPriceChangeCallback({
              yesAssetId: assetId,
              noAssetId: otherAssetId,
              yesPrice: currentPrice,
              noPrice: otherCurrentPrice,
              yesOrderBook: currentOrderBook,
              noOrderBook: otherOrderBook,
              priceChangePercent: priceChangePercent,
              windowStart: currentWindow.windowStart,
              windowEnd: currentWindow.windowEnd,
            });
          }

          logInfo(
            `[SpreadArbitrage] 价格变化超过阈值: ${assetId} 变化 ${priceChangePercent.toFixed(2)}%, ` +
              `当前价格: ${currentPrice}, 上一个窗口价格: ${previousPrice}, ` +
              `配对资产 ${otherAssetId} 价格: ${otherCurrentPrice}`
          );
        }
      }
    }
  }

  /**
   * 停止监控
   */
  stop(): void {
    if (this.windowTimer) {
      clearTimeout(this.windowTimer);
      this.windowTimer = null;
    }

    this.client.disconnect();
    this.currentWindow = null;
    this.previousWindow = null;
    this.subscribedAssetIds = [];

    logInfo("[SpreadArbitrage] 监控已停止");
  }

  /**
   * 获取客户端实例（用于外部访问）
   */
  getClient(): PolyMarketDataClient {
    return this.client;
  }
}

/**
 * 创建价差套利监控实例
 * @param windowSize 时间窗口大小（毫秒，变量占位，等待传入）
 * @param priceChangeThreshold 价格变化阈值（百分比，变量占位，等待传入）
 * @param onPriceChange 价格变化回调函数（占位函数，等待实现）
 */
export function createSpreadArbitrageMonitor({
  windowSize, // x ms，变量占位，等待传入
  priceChangeThreshold, // x%，变量占位，等待传入
  onPriceChange, // 占位函数，等待实现
}: {
  windowSize: number;
  priceChangeThreshold: number;
  onPriceChange?: (signal: PriceChangeSignal) => void;
}): SpreadArbitrageMonitor {
  return new SpreadArbitrageMonitor({
    windowSize,
    priceChangeThreshold,
    onPriceChange,
  });
}

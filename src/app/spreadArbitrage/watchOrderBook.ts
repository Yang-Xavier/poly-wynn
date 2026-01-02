import { PolyMarketDataClient } from "@shared/ws/PolyMarketData";
import { IWsLogger } from "@shared/ws/BaseLiveDataClient";
import { IMarketPushData } from "@typings/wsData";

/**
 * 订单簿数据结构
 * 使用交叉类型来实现 { [assetId: string]: { bestAsk, bestBid }, timestamp: number } 的结构
 */
export interface OrderBookData extends Record<
  string,
  { bestAsk: number; bestBid: number } | number
> {
  timestamp: number;
}

/**
 * 订单簿价格变化数据结构
 */
export interface OrderBookPriceChange {
  [assetId: string]: {
    bestAskChange: number;
  };
}

/**
 * 窗口回调参数
 */
export interface WindowOrderBookCallbackParams {
  orderBook: OrderBookData;
  priceChanges: OrderBookPriceChange;
}

/**
 * 订单簿监控类
 * 继承 PolyMarketDataClient，按50ms时间窗口缓存订单簿数据
 */
export class WatchOrderBook extends PolyMarketDataClient {
  // 50ms时间窗口相关
  private readonly windowSize: number = 50; // 50毫秒
  private windowTimer: NodeJS.Timeout | null = null;
  private currentWindowOrderBook: OrderBookData | null = null; // 当前窗口的最新订单簿
  private previousWindowOrderBook: OrderBookData | null = null; // 上一个窗口的订单簿

  // 订单簿缓存（15分钟）
  private readonly cacheDuration: number = 15 * 60 * 1000; // 15分钟
  private orderBookCache: OrderBookData[] = [];

  // 窗口回调函数
  private windowCallback: ((params: WindowOrderBookCallbackParams) => void) | null = null;

  // 最新订单簿
  private latestOrderBook: OrderBookData | null = null;

  constructor({ logger }: { logger: IWsLogger }) {
    super({ logger });
    // 监听订单簿价格变化事件
    this.onWatchOrderBookPriceChange((data: IMarketPushData) => {
      this.handleOrderBookUpdate(data);
    });
  }

  /**
   * 处理订单簿更新
   */
  private handleOrderBookUpdate(data: IMarketPushData): void {
    const { asset_id, asks, bids, timestamp } = data;

    // 计算 bestAsk 和 bestBid
    // asks 数组是升序排列，最后一个是最低卖价（bestAsk）
    // bids 数组是降序排列，最后一个是最高买价（bestBid）
    const bestAsk = asks && asks.length > 0 ? Number(asks[asks.length - 1].price) : null;
    const bestBid = bids && bids.length > 0 ? Number(bids[bids.length - 1].price) : null;

    if (bestAsk === null || bestBid === null) {
      return;
    }

    const timestampNum = Number(timestamp) || Date.now();

    // 初始化当前窗口订单簿
    if (!this.currentWindowOrderBook) {
      this.currentWindowOrderBook = {
        timestamp: timestampNum,
      } as OrderBookData;
    }

    // 更新当前窗口订单簿中该资产的数据（使用最新的数据）
    this.currentWindowOrderBook[asset_id] = {
      bestAsk,
      bestBid,
    };
    // 更新时间戳为最新的时间戳
    this.currentWindowOrderBook.timestamp = timestampNum;

    // 更新最新订单簿
    if (!this.latestOrderBook) {
      this.latestOrderBook = {
        timestamp: timestampNum,
      } as OrderBookData;
    }
    this.latestOrderBook[asset_id] = {
      bestAsk,
      bestBid,
    };
    this.latestOrderBook.timestamp = timestampNum;
  }

  /**
   * 连接成功时的回调：启动时间窗口定时器
   */
  protected onOpen(): void {
    super.onOpen();
    this.startWindowTimer();
  }

  /**
   * 启动50ms时间窗口定时器
   */
  private startWindowTimer(): void {
    if (this.windowTimer) {
      clearInterval(this.windowTimer);
    }

    // 立即开始第一个窗口
    this.currentWindowOrderBook = null;
    this.previousWindowOrderBook = null;

    // 每50ms执行一次
    this.windowTimer = setInterval(() => {
      this.processWindow();
    }, this.windowSize);
  }

  /**
   * 停止时间窗口定时器
   */
  private stopWindowTimer(): void {
    if (this.windowTimer) {
      clearInterval(this.windowTimer);
      this.windowTimer = null;
    }
  }

  /**
   * 处理时间窗口
   * 窗口结束时，调用回调函数传递当前窗口订单簿和涨跌幅
   */
  private processWindow(): void {
    // 如果当前窗口有订单簿数据
    if (this.currentWindowOrderBook) {
      // 添加到缓存
      this.addToCache(this.currentWindowOrderBook);

      // 如果有回调函数
      if (this.windowCallback) {
        // 计算每个资产的 bestAsk 涨跌幅
        const priceChanges: OrderBookPriceChange = {};
        const currentOrderBook = this.currentWindowOrderBook;

        if (this.previousWindowOrderBook) {
          // 遍历当前窗口的所有资产
          Object.keys(currentOrderBook).forEach((key) => {
            if (key === "timestamp") return;
            const assetId = key;
            const currentAssetData = currentOrderBook[assetId] as
              | { bestAsk: number; bestBid: number }
              | undefined;
            const previousAssetData = this.previousWindowOrderBook![assetId] as
              | { bestAsk: number; bestBid: number }
              | undefined;

            if (currentAssetData && previousAssetData) {
              const currentBestAsk = currentAssetData.bestAsk;
              const previousBestAsk = previousAssetData.bestAsk;

              // 计算涨跌幅百分比
              const bestAskChange = ((currentBestAsk - previousBestAsk) / previousBestAsk) * 100;
              priceChanges[assetId] = {
                bestAskChange,
              };
            }
          });
        }

        // 调用回调函数
        try {
          this.windowCallback({
            orderBook: this.deepCopyOrderBook(currentOrderBook),
            priceChanges,
          });
        } catch (error) {
          this.logger.logError?.(`[WatchOrderBook] 回调函数执行失败: ${error}`, error);
        }
      }

      // 将当前窗口订单簿保存为上一个窗口订单簿
      this.previousWindowOrderBook = this.deepCopyOrderBook(this.currentWindowOrderBook);
    }

    // 重置当前窗口订单簿（等待下一个窗口的数据）
    this.currentWindowOrderBook = null;
  }

  /**
   * 深拷贝订单簿数据
   */
  private deepCopyOrderBook(orderBook: OrderBookData): OrderBookData {
    const copy: OrderBookData = {
      timestamp: orderBook.timestamp,
    } as OrderBookData;
    Object.keys(orderBook).forEach((key) => {
      if (key !== "timestamp") {
        const assetData = orderBook[key] as { bestAsk: number; bestBid: number };
        copy[key] = { ...assetData };
      }
    });
    return copy;
  }

  /**
   * 添加到缓存并清理过期数据
   */
  private addToCache(orderBook: OrderBookData): void {
    this.orderBookCache.push(this.deepCopyOrderBook(orderBook));

    // 清理过期数据（15分钟前的数据）
    const expirationTime = Date.now() - this.cacheDuration;
    this.orderBookCache = this.orderBookCache.filter((item) => item.timestamp >= expirationTime);
  }

  /**
   * 获取最新订单簿
   */
  getLatestOrderBook(): OrderBookData | null {
    return this.latestOrderBook ? this.deepCopyOrderBook(this.latestOrderBook) : null;
  }

  /**
   * 设置窗口订单簿变化回调函数
   * 每50ms窗口结束时调用一次
   * @param callback 回调函数，传null表示移除回调
   */
  setWindowCallback(callback: ((params: WindowOrderBookCallbackParams) => void) | null): void {
    this.windowCallback = callback;
  }

  /**
   * 获取缓存的订单簿数据
   * @param duration 缓存时长（毫秒），默认15分钟
   */
  getCachedData(duration?: number): OrderBookData[] {
    const cacheDuration = duration ?? this.cacheDuration;
    const expirationTime = Date.now() - cacheDuration;
    return this.orderBookCache
      .filter((item) => item.timestamp >= expirationTime)
      .map((item) => this.deepCopyOrderBook(item));
  }

  /**
   * 断开连接时子类的清理逻辑
   */
  protected onDisconnectCleanup(): void {
    super.onDisconnectCleanup();
    this.stopWindowTimer();
    this.orderBookCache = [];
    this.latestOrderBook = null;
    this.currentWindowOrderBook = null;
    this.previousWindowOrderBook = null;
    this.windowCallback = null;
  }
}

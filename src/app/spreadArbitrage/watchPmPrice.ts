import { PolyLiveDataClient } from "@shared/ws/PolyLiveData";
import { IWsLogger } from "@shared/ws/BaseLiveDataClient";
import { logInfo, logError } from "./logger";

/**
 * 价格数据接口
 */
export interface PriceData {
  price: number;
  timestamp: number;
}

/**
 * 窗口价格变化回调参数
 */
export interface WindowPriceChange {
  currentPrice: number;
  previousPrice: number;
  priceChangePercent: number;
  currentTimestamp: number;
  previousTimestamp: number;
}

/**
 * Polymarket 价格监控类
 * 继承 PolyLiveDataClient，按50ms时间窗口缓存价格数据
 */
export class PolymarketPriceWatcher extends PolyLiveDataClient {
  // 50ms时间窗口相关
  private readonly windowSize: number = 50; // 50毫秒
  private windowTimer: NodeJS.Timeout | null = null;
  private currentWindowPrice: PriceData | null = null; // 当前窗口的最新价格
  private previousWindowPrice: PriceData | null = null; // 上一个窗口的价格

  // 价格缓存（15分钟）
  private readonly cacheDuration: number = 15 * 60 * 1000; // 15分钟
  private priceCache: PriceData[] = [];

  // 窗口回调函数
  private windowCallback: ((change: WindowPriceChange) => void) | null = null;

  // 最新价格
  private latestPrice: PriceData | null = null;

  constructor({ logger }: { logger: IWsLogger }) {
    super({ logger });
    // 监听价格变化事件
    this.onWatchPriceChange((price, historyPriceList) => {
      this.handlePriceUpdate(price);
    });
  }

  /**
   * 处理价格更新
   */
  private handlePriceUpdate(price: { value: number; timestamp: number }): void {
    const priceData: PriceData = {
      price: price.value,
      timestamp: price.timestamp,
    };

    // 更新最新价格
    this.latestPrice = priceData;

    // 更新当前窗口的价格（使用最新的价格）
    this.currentWindowPrice = priceData;

    // 添加到缓存
    this.addToCache(priceData);
  }

  /**
   * 添加到缓存并清理过期数据
   */
  private addToCache(priceData: PriceData): void {
    this.priceCache.push(priceData);

    // 清理过期数据（15分钟前的数据）
    const expirationTime = Date.now() - this.cacheDuration;
    this.priceCache = this.priceCache.filter((item) => item.timestamp >= expirationTime);
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
    this.currentWindowPrice = null;
    this.previousWindowPrice = null;

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
   * 窗口结束时，调用回调函数传递当前窗口价格和涨跌幅
   */
  private processWindow(): void {
    // 如果当前窗口有价格数据
    if (this.currentWindowPrice) {
      // 如果有回调函数
      if (this.windowCallback) {
        // 计算涨跌幅
        let priceChangePercent = 0;
        if (this.previousWindowPrice) {
          priceChangePercent =
            ((this.currentWindowPrice.price - this.previousWindowPrice.price) /
              this.previousWindowPrice.price) *
            100;
        }

        // 调用回调函数
        try {
          this.windowCallback({
            currentPrice: this.currentWindowPrice.price,
            previousPrice: this.previousWindowPrice?.price ?? this.currentWindowPrice.price,
            priceChangePercent,
            currentTimestamp: this.currentWindowPrice.timestamp,
            previousTimestamp:
              this.previousWindowPrice?.timestamp ?? this.currentWindowPrice.timestamp,
          });
        } catch (error) {
          logError(`[PolymarketPriceWatcher] 回调函数执行失败: ${error}`);
        }
      }

      // 将当前窗口价格保存为上一个窗口价格
      this.previousWindowPrice = this.currentWindowPrice;
    }

    // 重置当前窗口价格（等待下一个窗口的数据）
    this.currentWindowPrice = null;
  }

  /**
   * 获取最新价格
   */
  getLatestPrice(): PriceData | null {
    return this.latestPrice;
  }

  /**
   * 设置窗口价格变化回调函数
   * 每50ms窗口结束时调用一次
   * @param callback 回调函数，传null表示移除回调
   */
  setWindowCallback(callback: ((change: WindowPriceChange) => void) | null): void {
    this.windowCallback = callback;
  }

  /**
   * 获取缓存的价格数据
   * @param duration 缓存时长（毫秒），默认15分钟
   */
  getCachedData(duration?: number): PriceData[] {
    const cacheDuration = duration ?? this.cacheDuration;
    const expirationTime = Date.now() - cacheDuration;
    return this.priceCache.filter((item) => item.timestamp >= expirationTime);
  }

  /**
   * 断开连接时子类的清理逻辑
   */
  protected onDisconnectCleanup(): void {
    super.onDisconnectCleanup();
    this.stopWindowTimer();
    this.priceCache = [];
    this.latestPrice = null;
    this.currentWindowPrice = null;
    this.previousWindowPrice = null;
    this.windowCallback = null;
  }
}

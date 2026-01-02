import WebSocket from "ws";
import { IWsLogger } from "@shared/ws/BaseLiveDataClient";

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
 * 币安价格监控类
 * 订阅币安交易对的实时价格，按50ms时间窗口缓存价格数据
 */
export class BinancePriceWatcher {
  private ws: WebSocket | null = null;
  private symbol: string;
  private isConnected: boolean = false;
  private isManualDisconnect: boolean = false;
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 5;
  private readonly reconnectDelay: number = 3000;
  private readonly logger: IWsLogger;

  // 50ms时间窗口相关
  private readonly windowSize: number = 50; // 50毫秒
  private windowTimer: NodeJS.Timeout | null = null;
  private currentWindowPrice: PriceData | null = null; // 当前窗口的最新价格
  private previousWindowPrice: PriceData | null = null; // 上一个窗口的价格

  // 价格缓存（15分钟）
  private readonly cacheDuration: number = 15 * 60 * 1000; // 15分钟
  private priceCache: PriceData[] = [];

  // 回调函数
  private windowCallback: ((change: WindowPriceChange) => void) | null = null;

  // 最新价格
  private latestPrice: PriceData | null = null;

  constructor(symbol: string, { logger }: { logger: IWsLogger }) {
    // 确保symbol是小写
    this.symbol = symbol.toLowerCase();
    this.logger = logger;
  }

  /**
   * 连接WebSocket并订阅价格流
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      try {
        // 币安WebSocket流地址：wss://stream.binance.com:9443/ws/{symbol}@trade
        const url = `wss://stream.binance.com:9443/ws/${this.symbol}@trade`;
        this.ws = new WebSocket(url);

        this.ws.on("open", () => {
          this.logger.logInfo(`[BinancePriceWatcher] WebSocket连接已建立: ${this.symbol}`);
          this.isConnected = true;
          this.isManualDisconnect = false;
          this.reconnectAttempts = 0;
          this.startWindowTimer();
          resolve();
        });

        this.ws.on("message", (data: WebSocket.Data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleTradeMessage(message);
          } catch (error) {
            this.logger.logError?.(`[BinancePriceWatcher] 解析消息失败: ${error}`, error);
          }
        });

        this.ws.on("error", (error: Error) => {
          this.logger.logError?.(`[BinancePriceWatcher] WebSocket错误: ${error.message}`, error);
          this.isConnected = false;
          if (this.reconnectAttempts === 0) {
            reject(error);
          }
        });

        this.ws.on("close", (code: number, reason: Buffer) => {
          this.logger.logInfo(
            `[BinancePriceWatcher] WebSocket连接已关闭: ${code} - ${reason.toString()}`
          );
          this.isConnected = false;
          this.ws = null;
          this.stopWindowTimer();

          if (!this.isManualDisconnect) {
            this.attemptReconnect();
          } else {
            this.logger.logInfo(`[BinancePriceWatcher] 主动断开连接，不进行重连`);
          }
        });
      } catch (error) {
        this.logger.logError?.(`[BinancePriceWatcher] 连接失败: ${error}`, error);
        reject(error);
      }
    });
  }

  /**
   * 处理交易消息
   * 币安trade流消息格式：
   * {
   *   "e": "trade",
   *   "E": 123456789,
   *   "s": "BNBBTC",
   *   "t": 12345,
   *   "p": "0.001",
   *   "q": "100",
   *   "b": 88,
   *   "a": 50,
   *   "T": 123456785,
   *   "m": true,
   *   "M": true
   * }
   */
  private handleTradeMessage(message: any): void {
    // 验证消息格式
    if (message.e !== "trade" || !message.p || !message.T) {
      this.logger.logData?.(`[BinancePriceWatcher] 收到无效消息格式: ${JSON.stringify(message)}`);
      return;
    }

    const price = parseFloat(message.p);
    const timestamp = message.T;

    if (isNaN(price) || price <= 0) {
      this.logger.logData?.(
        `[BinancePriceWatcher] 收到无效价格: ${message.p}, timestamp: ${timestamp}`
      );
      return;
    }

    // 更新最新价格
    const priceData: PriceData = {
      price,
      timestamp,
    };
    this.latestPrice = priceData;

    // 更新当前窗口的价格（使用最新的价格）
    this.currentWindowPrice = priceData;

    // 记录价格数据
    // this.logger.logData?.(
    //   `[BinancePriceWatcher] 价格更新: symbol=${this.symbol}, price=${price}, timestamp=${timestamp}`
    // );

    // 添加到缓存
    this.addToCache(priceData);
  }

  /**
   * 添加到缓存并清理过期数据
   */
  private addToCache(priceData: PriceData): void {
    const beforeSize = this.priceCache.length;
    this.priceCache.push(priceData);

    // 清理过期数据（15分钟前的数据）
    const expirationTime = Date.now() - this.cacheDuration;
    this.priceCache = this.priceCache.filter((item) => item.timestamp >= expirationTime);

    const afterSize = this.priceCache.length;
    if (beforeSize !== afterSize) {
      //   this.logger.logData?.(
      //     `[BinancePriceWatcher] 缓存清理: 清理前=${beforeSize}, 清理后=${afterSize}, 清理数量=${beforeSize - afterSize}`
      //   );
    }
  }

  /**
   * 启动50ms时间窗口定时器
   */
  private startWindowTimer(): void {
    if (this.windowTimer) {
      clearInterval(this.windowTimer);
      this.logger.logInfo(`[BinancePriceWatcher] 停止旧的窗口定时器`);
    }

    // 立即开始第一个窗口
    this.currentWindowPrice = null;
    this.previousWindowPrice = null;

    // 每50ms执行一次
    this.windowTimer = setInterval(() => {
      this.processWindow();
    }, this.windowSize);

    this.logger.logInfo(`[BinancePriceWatcher] 窗口定时器已启动: 窗口大小=${this.windowSize}ms`);
  }

  /**
   * 停止时间窗口定时器
   */
  private stopWindowTimer(): void {
    if (this.windowTimer) {
      clearInterval(this.windowTimer);
      this.windowTimer = null;
      this.logger.logInfo(`[BinancePriceWatcher] 窗口定时器已停止`);
    }
  }

  /**
   * 处理时间窗口
   * 窗口结束时，调用回调函数传递当前窗口价格和涨跌幅
   */
  private processWindow(): void {
    // 如果当前窗口有价格数据
    if (this.currentWindowPrice) {
      // 计算涨跌幅
      let priceChangePercent = 0;
      if (this.previousWindowPrice) {
        priceChangePercent =
          ((this.currentWindowPrice.price - this.previousWindowPrice.price) /
            this.previousWindowPrice.price) *
          100;
      }

      // 窗口聚合后记录价格日志
      this.logger.logData?.(
        `[BinancePriceWatcher] 窗口聚合价格: symbol=${this.symbol}, ` +
          `price=${this.currentWindowPrice.price}, ` +
          `previousPrice=${this.previousWindowPrice?.price ?? this.currentWindowPrice.price}, ` +
          `priceChangePercent=${priceChangePercent.toFixed(4)}%, ` +
          `timestamp=${this.currentWindowPrice.timestamp}`
      );

      // 如果有回调函数
      if (this.windowCallback) {
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
          this.logger.logError?.(`[BinancePriceWatcher] 回调函数执行失败: ${error}`, error);
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
   * 尝试重连
   */
  private attemptReconnect(): void {
    if (this.isManualDisconnect) {
      this.logger.logInfo(`[BinancePriceWatcher] 已主动断开，不再尝试重连`);
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.logError?.(`[BinancePriceWatcher] 达到最大重连次数，停止重连`);
      return;
    }

    this.reconnectAttempts++;
    this.logger.logInfo(
      `[BinancePriceWatcher] ${this.reconnectDelay / 1000}秒后尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
    );

    setTimeout(() => {
      if (!this.isManualDisconnect) {
        this.connect().catch((error) => {
          this.logger.logError?.(`[BinancePriceWatcher] 重连失败: ${error}`, error);
        });
      } else {
        this.logger.logInfo(`[BinancePriceWatcher] 已主动断开，取消本次重连`);
      }
    }, this.reconnectDelay);
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.isManualDisconnect = true;
    this.stopWindowTimer();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.windowCallback = null;
    this.priceCache = [];
    this.latestPrice = null;
    this.currentWindowPrice = null;
    this.previousWindowPrice = null;
    this.logger.logInfo(`[BinancePriceWatcher] WebSocket连接已断开`);
  }

  /**
   * 获取连接状态
   */
  getConnectionStatus(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }
}

/*
// 创建监控实例（需要传入logger）
const watcher = new BinancePriceWatcher('btcusdt', {
  logger: {
    logInfo: (msg: string, data?: any) => console.log(`[BN] ${msg}`, data),
    logError: (msg: string, error?: any) => console.error(`[BN] ${msg}`, error),
    logData: (msg: string, data?: any) => console.log(`[BN] ${msg}`, data),
  },
});

// 连接并订阅
await watcher.connect();

// 设置回调函数
watcher.setWindowCallback((change) => {
  console.log(`当前价格: ${change.currentPrice}`);
  console.log(`涨跌幅: ${change.priceChangePercent.toFixed(2)}%`);
});

// 获取最新价格
const latest = watcher.getLatestPrice();

// 获取缓存数据（默认15分钟）
const cached = watcher.getCachedData();

// 获取最近5分钟的数据
const recent5min = watcher.getCachedData(5 * 60 * 1000);
*/

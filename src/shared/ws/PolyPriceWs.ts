import { HighPerformanceWs, IWsLogger } from "./HighPerformanceWs";
import { getGlobalConfig } from "../config";

// 订阅信息接口
interface Subscription {
  topic: string;
  type: string;
  filters: string | Record<string, any>;
}

// 订阅请求接口
interface SubscribeRequest {
  action: "subscribe";
  subscriptions: Subscription[];
}

// 推送数据接口
interface PushData {
  connection_id?: string;
  payload: any;
  timestamp: number;
  topic: string;
  type: string;
}

// 价格数据接口
interface PriceData {
  value: number;
  timestamp: number;
}

/**
 * Polymarket 价格 WebSocket 客户端
 * 继承 HighPerformanceWs，实现价格订阅和历史数据缓存
 */
export class PolyPriceWs extends HighPerformanceWs {
  private topic: string = "crypto_prices_chainlink";
  private subscriptions: Subscription[] = [];
  private priceCallback: ((price: PriceData) => void) | null = null;
  private isFirstConnect: boolean = true; // 标记是否是首次连接

  /**
   * 构造函数
   * @param logger Logger 实例
   */
  constructor(params: { logger: IWsLogger }) {
    const globalConfig = getGlobalConfig();

    // 调用父类构造函数，窗口时间设置为 100ms
    super({
      logger: params.logger,
      url: globalConfig.ws.liveDataUrl,
      windowTime: 100, // 窗口时间 100ms
    });

    // 创建 priceHistory 缓存：maxSize=10000，不设置过期时间
    this.cacheController.createCache(
      "priceHistory",
      10000, // maxSize
      Number.MAX_SAFE_INTEGER, // expire: 不设置过期时间，使用最大值
      Date.now() // createdAt
    );

    // 设置窗口期结束时的回调（HighPerformanceWs 已经处理了窗口聚合，这里直接处理聚合后的消息）
    this.setMessageCallback((messages: any[]) => {
      // HighPerformanceWs 已经确保 messages 不为空才调用回调
      // 获取窗口期里最近的一条数据
      const latestMessage = messages[messages.length - 1];

      try {
        // 解析消息
        let message: PushData;
        if (typeof latestMessage === "string") {
          message = JSON.parse(latestMessage);
        } else {
          message = latestMessage;
        }

        // 检查是否是价格数据
        if (message.topic === this.topic && message.payload) {
          const priceData: PriceData = {
            value: Number(message.payload.value),
            timestamp: Number(message.payload.timestamp),
          };
          // 缓存到 priceHistory
          const priceHistoryCache = this.cacheController.getCache("priceHistory");
          if (priceHistoryCache) {
            priceHistoryCache.push(priceData);
          }

          // 回调外部
          if (this.priceCallback) {
            try {
              this.priceCallback(priceData);
            } catch (error) {
              // 使用父类的 send 方法无法记录日志，这里简化处理
              console.error("价格回调函数执行失败", error);
            }
          }
          this.logger.logData(`[PolyPriceWs]: ${JSON.stringify(priceData)}`);
        }
      } catch (error) {
        // 使用父类的 send 方法无法记录日志，这里简化处理
        console.error("处理窗口消息失败", error);
      }
    });
  }

  /**
   * 连接成功时的回调：重新发送已有订阅（仅在重连时调用）
   */
  private onReconnect(): void {
    if (this.subscriptions.length > 0) {
      this.sendSubscriptions(this.subscriptions);
    }
  }

  /**
   * 重写 connect 方法
   * 首次连接时不自动订阅，重连时自动订阅
   */
  async connect(): Promise<void> {
    const wasFirstConnect = this.isFirstConnect;

    // 先调用父类的 connect
    await super.connect();

    // 如果是首次连接，不自动订阅
    if (wasFirstConnect) {
      this.isFirstConnect = false;
      return;
    }

    // 如果是重连，自动重新订阅
    this.onReconnect();
  }

  /**
   * 发送订阅请求
   */
  private sendSubscriptions(subscriptions: Subscription[]): void {
    if (!this.getConnectionStatus()) {
      this.logger.logInfo("[PolyPriceWs] WebSocket 未连接，无法发送订阅");
      return;
    }

    const request: SubscribeRequest = {
      action: "subscribe",
      subscriptions: subscriptions.map((sub) => ({
        ...sub,
        filters: typeof sub.filters === "string" ? sub.filters : JSON.stringify(sub.filters),
      })),
    };

    const message = JSON.stringify(request);
    this.send(message);
    this.logger.logInfo("[PolyPriceWs] 发送订阅请求", message);
  }

  /**
   * 订阅加密货币价格数据（Chainlink）
   * @param symbol 交易对符号，如 'eth/usd'
   */
  subscribeCryptoPrices(symbol: string): void {
    const subscription: Subscription = {
      topic: "crypto_prices_chainlink",
      type: "update",
      filters: JSON.stringify({ symbol }),
    };

    // 检查是否已存在相同的订阅（避免重复订阅）
    const existingIndex = this.subscriptions.findIndex(
      (sub) => sub.topic === subscription.topic && sub.filters === subscription.filters
    );

    if (existingIndex === -1) {
      // 如果不存在，添加到订阅列表
      this.subscriptions.push(subscription);
    } else {
      // 如果已存在，更新订阅信息（保持索引位置）
      this.subscriptions[existingIndex] = subscription;
    }

    // 如果已连接，立即发送订阅
    if (this.getConnectionStatus()) {
      this.sendSubscriptions([subscription]);
    }
  }

  /**
   * 设置价格回调函数
   * 每次窗口期结束时，会调用此回调，传递窗口期里最近的一条数据
   * @param callback 回调函数，接收价格数据
   */
  onPriceChange(callback: (price: PriceData) => void): void {
    this.priceCallback = callback;
  }

  /**
   * 获取缓存的历史价格列表
   * @returns 价格数据列表
   */
  getPriceHistory(): PriceData[] {
    const priceHistoryCache = this.cacheController.getCache("priceHistory");
    if (!priceHistoryCache) {
      return [];
    }
    return priceHistoryCache.getList() as PriceData[];
  }

  /**
   * 获取最新推送来的数据（不是窗口推送的，是原始推送的）
   * @returns 最新推送的价格数据（PriceData 结构），如果没有则返回 null
   */
  getLatestPriceData(): PriceData | null {
    const latestMessage = this.getLatestMessage();
    if (!latestMessage) {
      return null;
    }

    try {
      // 解析消息
      let message: PushData;
      if (typeof latestMessage === "string") {
        message = JSON.parse(latestMessage);
      } else {
        message = latestMessage;
      }

      // 检查是否是价格数据
      if (message.topic === this.topic && message.payload) {
        return {
          value: Number(message.payload.value),
          timestamp: Number(message.payload.timestamp),
        };
      }

      return null;
    } catch (error) {
      console.error("解析最新消息失败", error);
      return null;
    }
  }
}

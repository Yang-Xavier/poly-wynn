import { WS_BN_PRICE_URL } from "@shared/constants";
import { HighPerformanceWs, IWsLogger } from "./HighPerformanceWs";

// 价格数据接口
export interface PriceData {
  value: number;
  timestamp: number;
}

/**
 * 币安价格 WebSocket 客户端
 * 继承 HighPerformanceWs，实现币安价格订阅和历史数据缓存
 */
export class BnPriceWs extends HighPerformanceWs {
  private priceCallback: ((price: PriceData) => void) | null = null;

  /**
   * 构造函数
   * @param logger Logger 实例
   * @param symbol 交易对符号，如 'btcusdt'（会自动转换为小写）
   */
  constructor(params: { logger: IWsLogger; symbol: string; windowTime?: number }) {
    // 确保symbol是小写
    const symbol = params.symbol.toLowerCase();
    const url = `${WS_BN_PRICE_URL}/${symbol}@trade`;

    // 调用父类构造函数，窗口时间设置为 50ms（参考 watchBnPrice.ts）
    super({
      logger: params.logger,
      url,
      windowTime: params.windowTime || 100, // 窗口时间 50ms
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
        let message: any;
        if (typeof latestMessage === "string") {
          message = JSON.parse(latestMessage);
        } else {
          message = latestMessage;
        }

        // 验证消息格式（币安 trade 流格式）
        if (message.e === "trade" && message.p && message.T) {
          const price = parseFloat(message.p);
          const timestamp = message.T;

          if (isNaN(price) || price <= 0) {
            this.logger.logError(`[BnPriceWs] 收到无效价格: ${message.p}, timestamp: ${timestamp}`);
            return;
          }

          const priceData: PriceData = {
            value: price,
            timestamp,
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
              this.logger.logError(`[BnPrice] 价格回调函数执行失败 ${error}`, error);
            }
          }
          this.logger.customTypeLog("BnPriceWs", JSON.stringify(priceData));
        }
      } catch (error) {
        this.logger.logError(`[BnPriceWs] 处理窗口消息失败 ${error}`, error);
      }
    });
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
      let message: any;
      if (typeof latestMessage === "string") {
        message = JSON.parse(latestMessage);
      } else {
        message = latestMessage;
      }

      // 验证消息格式（币安 trade 流格式）
      if (message.e === "trade" && message.p && message.T) {
        const price = parseFloat(message.p);
        const timestamp = message.T;

        if (isNaN(price) || price <= 0) {
          return null;
        }

        return {
          value: price,
          timestamp,
        };
      }

      return null;
    } catch (error) {
      this.logger.logError(`[BnPriceWs] 解析最新消息失败 ${error}`, error);
      return null;
    }
  }
}

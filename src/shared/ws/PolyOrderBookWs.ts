import { HighPerformanceWs, IWsLogger } from "./HighPerformanceWs";
import { getGlobalConfig } from "../config";
import { IMarketPushData } from "@typings/wsData";

// 订单簿数据结构
export interface OrderBookData extends Record<
  string,
  { bestAsk: number; bestBid: number; timestamp: number }
> {}

// 订阅请求接口
interface MarketSubscriptionRequest {
  assets_ids: string[];
  type: "market";
}

/**
 * Polymarket 订单簿 WebSocket 客户端
 * 继承 HighPerformanceWs，实现订单簿订阅和历史数据缓存
 */
export class PolyOrderBookWs extends HighPerformanceWs {
  private subscribedAssetIds: string[] = [];
  private orderBookCallback: ((params: OrderBookData) => void) | null = null;
  private isFirstConnect: boolean = true; // 标记是否是首次连接

  /**
   * 构造函数
   * @param logger Logger 实例
   */
  constructor(params: { logger: IWsLogger; windowTime?: number }) {
    const globalConfig = getGlobalConfig();

    // 调用父类构造函数，窗口时间设置为 50ms（参考 watchOrderBook.ts）
    super({
      logger: params.logger,
      url: globalConfig.ws.marketDataUrl,
      windowTime: params.windowTime || 50, // 窗口时间 50ms
    });

    // 创建 orderBookHistory 缓存：maxSize=10000，不设置过期时间
    this.cacheController.createCache(
      "orderBookHistory",
      100000, // maxSize
      Number.MAX_SAFE_INTEGER, // expire: 不设置过期时间，使用最大值
      Date.now() // createdAt
    );

    // 设置窗口期结束时的回调（HighPerformanceWs 已经处理了窗口聚合，这里直接处理聚合后的消息）
    this.setMessageCallback((messages: any[]) => {
      // HighPerformanceWs 已经确保 messages 不为空才调用回调
      // 处理窗口期内的所有消息，聚合订单簿数据
      this.handleWindowMessages(messages);
    });
  }

  /**
   * 处理窗口期内的消息
   * 聚合所有消息中的订单簿数据，取每个资产的最新数据
   */
  private handleWindowMessages(messages: any[]): void {
    // 初始化当前窗口订单簿（使用局部变量）
    const currentWindowOrderBook: OrderBookData = {} as OrderBookData;

    // 遍历窗口期内的所有消息，聚合订单簿数据
    for (const rawMessage of messages) {
      try {
        // 解析消息
        let message: IMarketPushData;
        if (typeof rawMessage === "string") {
          message = JSON.parse(rawMessage);
        } else {
          message = rawMessage;
        }

        // 检查是否是订单簿数据
        if (message.event_type === "book" && message.asset_id) {
          const { asset_id, asks, bids, timestamp } = message;

          // 计算 bestAsk 和 bestBid
          // asks 数组是升序排列，最后一个是最低卖价（bestAsk）
          // bids 数组是降序排列，最后一个是最高买价（bestBid）
          const bestAsk = asks && asks.length > 0 ? Number(asks[asks.length - 1].price) : null;
          const bestBid = bids && bids.length > 0 ? Number(bids[bids.length - 1].price) : null;

          if (bestAsk === null || bestBid === null) {
            continue;
          }

          const timestampNum = Number(timestamp) || Date.now();

          // 更新当前窗口订单簿中该资产的数据（使用最新的数据，包含 timestamp）
          currentWindowOrderBook[asset_id] = {
            bestAsk,
            bestBid,
            timestamp: timestampNum,
          };
        }
      } catch (error) {
        if (this.logger.logError) {
          this.logger.logError("处理窗口消息失败", error);
        } else {
          this.logger.logInfo("处理窗口消息失败", error);
        }
      }
    }

    // 如果当前窗口有订单簿数据，处理窗口结束逻辑
    if (Object.keys(currentWindowOrderBook).length > 0) {
      // 添加到缓存
      const orderBookHistoryCache = this.cacheController.getCache("orderBookHistory");
      if (orderBookHistoryCache) {
        orderBookHistoryCache.push(currentWindowOrderBook);
      }

      // 回调外部
      if (this.orderBookCallback) {
        try {
          this.orderBookCallback(currentWindowOrderBook);
        } catch (error) {
          if (this.logger.logError) {
            this.logger.logError("订单簿回调函数执行失败", error);
          } else {
            this.logger.logInfo("订单簿回调函数执行失败", error);
          }
        }
      }

      this.logger.customTypeLog("PolyOrderBookWs", JSON.stringify(currentWindowOrderBook));
    }
  }

  /**
   * 连接成功时的回调：重新发送已有订阅（仅在重连时调用）
   */
  private onReconnect(): void {
    if (this.subscribedAssetIds.length > 0) {
      this.sendSubscription();
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
   * @param assetIds 资产ID数组，如果不提供则使用已保存的订阅列表
   */
  private sendSubscription(assetIds?: string[]): void {
    // 如果提供了 assetIds，更新订阅列表
    if (assetIds) {
      if (!Array.isArray(assetIds) || assetIds.length === 0) {
        this.logger.logInfo("[PolyOrderBookWs] 资产ID列表为空，无法订阅");
        return;
      }

      // 更新订阅的资产ID列表（去重）
      const uniqueAssetIds = Array.from(new Set(assetIds));
      this.subscribedAssetIds = uniqueAssetIds;
    }

    if (!this.getConnectionStatus()) {
      this.logger.logInfo("[PolyOrderBookWs] WebSocket 未连接，无法发送订阅");
      return;
    }

    if (this.subscribedAssetIds.length === 0) {
      this.logger.logInfo("[PolyOrderBookWs] 资产ID列表为空，无法订阅");
      return;
    }

    const subscription: MarketSubscriptionRequest = {
      assets_ids: this.subscribedAssetIds,
      type: "market",
    };

    const message = JSON.stringify(subscription);
    this.send(message);
    this.logger.logInfo("[PolyOrderBookWs] 发送订阅请求", message);
  }

  /**
   * 订阅订单簿数据
   * @param assetIds 资产ID数组
   */
  subscribeOrderBook(assetIds: string[]): void {
    this.sendSubscription(assetIds);
  }

  /**
   * 设置订单簿回调函数
   * 每次窗口期结束时，会调用此回调，传递窗口期聚合的订单簿数据
   * @param callback 回调函数，接收订单簿数据
   */
  onOrderBookChange(callback: (params: OrderBookData) => void): void {
    this.orderBookCallback = callback;
  }

  /**
   * 获取最新推送来的订单簿数据（不是窗口推送的，是原始推送的）
   * 从 RawData 缓存中从后往前查找匹配 assetId 的数据
   * @param assetId 资产ID，必须提供
   * @returns 最新推送的订单簿数据，如果没有则返回 null
   */
  getLatestOrderBookData(assetId: string): OrderBookData | null {
    if (!assetId) {
      return null;
    }

    // 从 RawData 缓存中获取所有原始数据
    const rawDataCache = this.cacheController.getCache("RawData");
    if (!rawDataCache) {
      return null;
    }

    const rawDataList = rawDataCache.getList();
    if (rawDataList.length === 0) {
      return null;
    }

    // 从后往前遍历，找到匹配 assetId 的订单簿数据
    for (let i = rawDataList.length - 1; i >= 0; i--) {
      try {
        const rawMessage = rawDataList[i];

        // 解析消息
        let message: IMarketPushData;
        if (typeof rawMessage === "string") {
          message = JSON.parse(rawMessage);
        } else {
          message = rawMessage;
        }

        // 检查是否是订单簿数据且匹配 assetId
        if (message.event_type === "book" && message.asset_id === assetId) {
          const { asset_id, asks, bids, timestamp } = message;
          const bestAsk = asks && asks.length > 0 ? Number(asks[asks.length - 1].price) : null;
          const bestBid = bids && bids.length > 0 ? Number(bids[bids.length - 1].price) : null;

          if (bestAsk === null || bestBid === null) {
            continue;
          }

          const timestampNum = Number(timestamp) || Date.now();

          const orderBook: OrderBookData = {
            [asset_id]: {
              bestAsk,
              bestBid,
              timestamp: timestampNum,
            },
          } as OrderBookData;

          return orderBook;
        }
      } catch (error) {
        // 解析失败，继续查找下一条
        continue;
      }
    }

    return null;
  }
}

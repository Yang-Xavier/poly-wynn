import { WS_LIVE_DATA_URL } from "@shared/constants";
import { HighPerformanceWs, IWsLogger } from "./HighPerformanceWs";
import { DataRecords } from "@shared/DataRecords";

// 订阅认证信息接口
export interface UserSubscriptionAuth {
  apiKey: string;
  secret: string;
  passphrase: string;
}

// 订阅请求接口
export interface UserSubscriptionRequest {
  auth: UserSubscriptionAuth;
  markets: string[];
  type: "user";
}

// Maker Order 接口
export interface MakerOrder {
  asset_id: string;
  matched_amount: string;
  order_id: string;
  outcome: "YES" | "NO";
  owner: string;
  price: string;
}

// 用户交易数据接口
export interface UserTradeData {
  asset_id: string;
  event_type: "trade";
  id: string;
  last_update: string;
  maker_orders: MakerOrder[];
  market: string;
  matchtime: string;
  outcome: "YES" | "NO";
  owner: string;
  price: string;
  side: "BUY" | "SELL";
  size: string;
  status: "MATCHED" | string;
  taker_order_id: string;
  timestamp: string;
  trade_owner: string;
  type: "TRADE";
}

/**
 * 用户频道 WebSocket 客户端
 * 继承 HighPerformanceWs，实现用户交易订阅
 */
export class UserWs extends HighPerformanceWs {
  private tradeCallback: ((trade: UserTradeData) => void) | null = null;
  private subscriptionRequest: UserSubscriptionRequest | null = null;
  private auth: UserSubscriptionAuth;
  private markets: string[];

  /**
   * 构造函数
   * @param logger Logger 实例
   * @param auth 认证信息
   * @param markets 市场列表（可选，空数组表示订阅所有市场），默认 []
   * @param windowTime 窗口时间（毫秒），默认 100ms
   * @param dataRecord DataRecords 实例（可选）
   */
  constructor(params: {
    logger: IWsLogger;
    auth: UserSubscriptionAuth;
    markets?: string[];
    windowTime?: number;
    dataRecord?: DataRecords;
  }) {
    // 调用父类构造函数
    super({
      logger: params.logger,
      url: WS_LIVE_DATA_URL,
      windowTime: params.windowTime || 100,
      dataRecord: params.dataRecord,
    });

    // 保存认证信息和市场列表
    this.auth = params.auth;
    this.markets = params.markets || [];

    // 初始化订阅请求
    this.subscriptionRequest = {
      auth: this.auth,
      markets: this.markets,
      type: "user",
    };

    // 设置窗口期结束时的回调
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

        // 检查是否是 trade 事件
        if (message.event_type.toLowerCase() === "trade") {
          // 验证必要字段
          if (message.asset_id && message.id && message.market) {
            const tradeData: UserTradeData = {
              asset_id: message.asset_id,
              event_type: message.event_type,
              id: message.id,
              last_update: message.last_update || message.timestamp,
              maker_orders: message.maker_orders || [],
              market: message.market,
              matchtime: message.matchtime || message.timestamp,
              outcome: message.outcome,
              owner: message.owner,
              price: message.price,
              side: message.side,
              size: message.size,
              status: message.status,
              taker_order_id: message.taker_order_id,
              timestamp: message.timestamp,
              trade_owner: message.trade_owner || message.owner,
              type: message.type,
            };

            // 回调外部
            if (this.tradeCallback) {
              try {
                this.tradeCallback(tradeData);
              } catch (error) {
                if (this.logger.logError) {
                  this.logger.logError("[UserWs] 交易回调函数执行失败", error);
                } else {
                  this.logger.logInfo("[UserWs] 交易回调函数执行失败", error);
                }
              }
            }
          }
        }
      } catch (error) {
        if (this.logger.logError) {
          this.logger.logError(`[UserWs] 处理窗口消息失败 ${error}`, error);
        } else {
          this.logger.logInfo(`[UserWs] 处理窗口消息失败 ${error}`, error);
        }
      }
    });
  }

  /**
   * 重写 connect 方法
   * 连接成功后自动发送订阅请求
   */
  async connect(): Promise<void> {
    // 先调用父类的 connect
    await super.connect();

    // 连接成功后自动发送订阅
    if (this.subscriptionRequest) {
      this.sendSubscription(this.subscriptionRequest);
    }
  }

  /**
   * 更新市场列表并重新订阅
   * @param markets 市场列表（可选，空数组表示订阅所有市场）
   */
  subscribe(markets: string[] = []): void {
    // 更新市场列表
    this.markets = markets;

    // 更新订阅请求
    this.subscriptionRequest = {
      auth: this.auth,
      markets: this.markets,
      type: "user",
    };

    // 如果已连接，立即发送订阅
    if (this.getConnectionStatus()) {
      this.sendSubscription(this.subscriptionRequest);
    }
  }

  /**
   * 发送订阅请求
   */
  private sendSubscription(subscription: UserSubscriptionRequest): void {
    if (!this.getConnectionStatus()) {
      this.logger.logInfo("[UserWs] WebSocket 未连接，无法发送订阅");
      return;
    }

    const message = JSON.stringify(subscription);
    this.send(message);
    this.logger.logInfo("[UserWs] 发送订阅请求", {
      type: subscription.type,
      marketsCount: subscription.markets.length,
    });
  }

  /**
   * 设置交易回调函数
   * 每次窗口期结束时，会调用此回调，传递窗口期里最近的一条交易数据
   * @param callback 回调函数，接收交易数据
   */
  onUserTrade(callback: (trade: UserTradeData) => void): void {
    this.tradeCallback = callback;
  }

  /**
   * 获取最新推送来的交易数据（不是窗口推送的，是原始推送的）
   * @returns 最新推送的交易数据，如果没有则返回 null
   */
  getLatestTradeData(): UserTradeData | null {
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

      // 检查是否是 trade 事件
      if (message.event_type === "trade" && message.type === "TRADE") {
        // 验证必要字段
        if (message.asset_id && message.id && message.market) {
          return {
            asset_id: message.asset_id,
            event_type: message.event_type,
            id: message.id,
            last_update: message.last_update || message.timestamp,
            maker_orders: message.maker_orders || [],
            market: message.market,
            matchtime: message.matchtime || message.timestamp,
            outcome: message.outcome,
            owner: message.owner,
            price: message.price,
            side: message.side,
            size: message.size,
            status: message.status,
            taker_order_id: message.taker_order_id,
            timestamp: message.timestamp,
            trade_owner: message.trade_owner || message.owner,
            type: message.type,
          };
        }
      }

      return null;
    } catch (error) {
      if (this.logger.logError) {
        this.logger.logError("解析最新消息失败", error);
      } else {
        this.logger.logInfo("解析最新消息失败", error);
      }
      return null;
    }
  }
}

import WebSocket from "ws";
import { CacheController } from "../Cache";
import { DataRecords } from "../DataRecords";

/**
 * Logger 接口定义
 */
export interface IWsLogger {
  logInfo: (message: string, ...args: any[]) => void;
  logData?: (message: string, ...args: any[]) => void;
  logError?: (message: string, ...args: any[]) => void;
  customTypeLog?: (type: string, message: string, ...args: any[]) => void;
  [key: string]: any;
}

/**
 * 基础 WebSocket 客户端类
 * 支持消息聚合、断线重连等功能
 */
export class HighPerformanceWs {
  protected logger: IWsLogger;
  protected dataRecord: DataRecords | undefined;
  private ws: WebSocket | null = null;
  private url: string;
  private windowTime: number; // 聚合窗口时间（毫秒）

  // 连接状态
  private isConnected: boolean = false;
  private isManualDisconnect: boolean = false;

  // 重连相关
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 5;
  private readonly reconnectDelay: number = 3000;

  // 消息聚合相关
  private messageBuffer: any[] = []; // 窗口内的消息缓冲区
  private windowTimer: NodeJS.Timeout | null = null; // 窗口定时器
  private messageCallback: ((data: { message: any; receivedAt?: number }[]) => void) | null = null; // 消息回调函数

  // 最新消息
  private latestMessage: { message: any; receivedAt: number } | null = null;

  // 缓存控制器
  public readonly cacheController: CacheController<any>;

  /**
   * 构造函数
   * @param logger Logger 实例，包含 logInfo、logData、logError 等方法
   * @param url WebSocket 服务器地址
   * @param windowTime 聚合窗口时间（毫秒），在此时间窗口内的消息会被聚合成列表
   * @param dataRecord DataRecords 实例，用于数据记录（可选）
   */
  constructor(params: {
    logger: IWsLogger;
    url: string;
    windowTime: number;
    dataRecord?: DataRecords;
  }) {
    this.logger = params.logger;
    this.url = params.url;
    this.windowTime = params.windowTime;
    this.dataRecord = params.dataRecord;

    // 初始化缓存控制器
    this.cacheController = new CacheController<any>();

    // 创建 RawData 缓存：maxSize=100000，不设置到期时间（设置为最大值）
    this.cacheController.createCache(
      "RawData",
      100000, // maxSize
      Number.MAX_SAFE_INTEGER, // expire: 不设置到期时间，使用最大值
      Date.now() // createdAt
    );
  }

  /**
   * 设置消息回调函数
   * @param callback 回调函数，接收聚合后的消息列表
   */
  setMessageCallback(callback: (messages: any[]) => void): void {
    this.messageCallback = callback;
  }

  /**
   * 获取最新一条推送的数据
   * @returns 最新消息，如果没有则返回 null
   */
  getLatestMessage(): { message: any; receivedAt: number } | null {
    return this.latestMessage;
  }

  /**
   * 连接 WebSocket
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
        this.logger.logInfo("WebSocket 已连接，无需重复连接");
        resolve();
        return;
      }

      try {
        this.ws = new WebSocket(this.url);

        this.ws.on("open", () => {
          this.logger.logInfo(`WebSocket 连接已建立: ${this.url}`);
          this.isConnected = true;
          this.isManualDisconnect = false;
          this.reconnectAttempts = 0;
          resolve();
        });

        this.ws.on("message", (data: WebSocket.Data) => {
          this.handleMessage(data, Date.now());
        });

        this.ws.on("error", (error: Error) => {
          if (this.logger.logError) {
            this.logger.logError("WebSocket 错误", error.message);
          } else {
            this.logger.logInfo("WebSocket 错误", error.message);
          }
          this.isConnected = false;
          if (this.reconnectAttempts === 0) {
            reject(error);
          }
        });

        this.ws.on("close", (code: number, reason: Buffer) => {
          this.logger.logInfo(`WebSocket 连接已关闭: ${code} - ${reason.toString()}`);
          this.isConnected = false;
          this.ws = null;

          // 清理窗口定时器
          this.clearWindowTimer();

          if (!this.isManualDisconnect) {
            this.attemptReconnect();
          } else {
            this.logger.logInfo("主动断开连接，不进行重连");
          }
        });
      } catch (error) {
        if (this.logger.logError) {
          this.logger.logError("WebSocket 连接失败", error);
        } else {
          this.logger.logInfo("WebSocket 连接失败", error);
        }
        reject(error);
      }
    });
  }

  /**
   * 检查消息是否是 ping/pong 消息
   */
  private isPingPongMessage(message: any): boolean {
    if (typeof message === "string") {
      const lowerMessage = message.toLowerCase().trim();
      return lowerMessage === "ping" || lowerMessage === "pong";
    }

    if (typeof message === "object" && message !== null) {
      // 检查对象中是否包含 ping/pong 字段
      const messageStr = JSON.stringify(message).toLowerCase();
      return messageStr.includes('"ping"') || messageStr.includes('"pong"');
    }

    return false;
  }

  /**
   * 处理接收到的消息
   */
  private handleMessage(data: WebSocket.Data, receivedAt: number): void {
    try {
      let message: any;
      // 尝试解析 JSON，如果失败则使用原始数据
      try {
        message = JSON.parse(data.toString());
      } catch {
        message = data.toString();
      }

      // 如果是 ping/pong 消息，不添加到缓存
      if (this.isPingPongMessage(message)) {
        return;
      }

      // 更新最新消息
      this.latestMessage = { message, receivedAt };

      // 将消息添加到 RawData 缓存（未经过时间窗口聚合的原始数据）
      const rawDataCache = this.cacheController.getCache("RawData");
      if (rawDataCache) {
        rawDataCache.push({ message, receivedAt });
      }

      // 将消息添加到缓冲区
      this.messageBuffer.push({ message, receivedAt });

      // 如果窗口定时器不存在，启动一个新的窗口定时器
      if (!this.windowTimer) {
        this.startWindowTimer();
      }
    } catch (error) {
      if (this.logger.logError) {
        this.logger.logError("处理消息失败", error, data.toString());
      } else {
        this.logger.logInfo("处理消息失败", error, data.toString());
      }
    }
  }

  /**
   * 启动窗口定时器
   */
  private startWindowTimer(): void {
    this.windowTimer = setTimeout(() => {
      this.flushMessages();
    }, this.windowTime);
  }

  /**
   * 清空窗口定时器
   */
  private clearWindowTimer(): void {
    if (this.windowTimer) {
      clearTimeout(this.windowTimer);
      this.windowTimer = null;
    }
  }

  /**
   * 刷新消息缓冲区，将聚合的消息通过回调传递
   * 注意：如果窗口期内没有接收到任何数据，不会调用回调
   */
  private flushMessages(): void {
    // 如果窗口期内没有接收到数据，直接返回，不调用回调
    if (this.messageBuffer.length === 0) {
      this.clearWindowTimer();
      return;
    }

    // 复制消息列表并清空缓冲区
    const messages = [...this.messageBuffer];
    this.messageBuffer = [];

    // 清空定时器
    this.clearWindowTimer();

    // 通过回调传递聚合的消息列表
    if (this.messageCallback) {
      try {
        this.messageCallback(messages);
      } catch (error) {
        if (this.logger.logError) {
          this.logger.logError("消息回调函数执行失败", error);
        } else {
          this.logger.logInfo("消息回调函数执行失败", error);
        }
      }
    }
  }

  /**
   * 尝试重连
   */
  private attemptReconnect(): void {
    if (this.isManualDisconnect) {
      this.logger.logInfo("已主动断开，不再尝试重连");
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.logInfo(`达到最大重连次数 (${this.maxReconnectAttempts})，停止重连`);
      return;
    }

    this.reconnectAttempts++;
    this.logger.logInfo(
      `${this.reconnectDelay / 1000}秒后尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
    );

    setTimeout(() => {
      // 在真正重连前再次检查是否已经被主动断开
      if (this.isManualDisconnect) {
        this.logger.logInfo("已主动断开，取消本次重连");
        return;
      }
      this.connect().catch((error) => {
        if (this.logger.logError) {
          this.logger.logError("重连失败", error);
        } else {
          this.logger.logInfo("重连失败", error);
        }
      });
    }, this.reconnectDelay);
  }

  /**
   * 发送消息
   * @param data 要发送的数据
   */
  send(data: string | Buffer | ArrayBuffer | Buffer[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.logInfo("WebSocket 未连接，无法发送消息");
      return;
    }

    try {
      this.ws.send(data);
    } catch (error) {
      if (this.logger.logError) {
        this.logger.logError("发送消息失败", error);
      } else {
        this.logger.logInfo("发送消息失败", error);
      }
    }
  }

  /**
   * 获取连接状态
   * @returns 是否已连接
   */
  getConnectionStatus(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * 断开连接并清理资源
   */
  disconnect(): void {
    // 标记为主动断开，阻止自动重连
    this.isManualDisconnect = true;

    // 刷新剩余的消息
    this.flushMessages();

    // 清理窗口定时器
    this.clearWindowTimer();

    // 关闭 WebSocket 连接
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.logger.logInfo("WebSocket 连接已断开");
  }

  /**
   * 清理所有资源
   */
  cleanup(): void {
    this.disconnect();

    // 清空消息缓冲区和最新消息
    this.messageBuffer = [];
    this.latestMessage = null;

    // 清空回调函数
    this.messageCallback = null;

    // 清理所有缓存
    this.cacheController.clear();

    this.logger.logInfo("WebSocket 资源已清理");
  }
}

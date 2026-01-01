import { logInfo } from "../module/logger";

/**
 * Pyth 价格信息
 */
export interface PythPriceInfo {
  /** 价格值（字符串格式，避免精度丢失） */
  price: string;
  /** 置信区间 */
  conf: string;
  /** 指数（用于计算实际价格：price * 10^expo） */
  expo: number;
  /** 发布时间戳（Unix 时间戳） */
  publish_time: number;
}

/**
 * Pyth 价格元数据
 */
export interface PythPriceMetadata {
  /** Solana slot 编号 */
  slot: number;
  /** 证明可用时间（Unix 时间戳） */
  proof_available_time: number;
  /** 上一个发布时间（Unix 时间戳） */
  prev_publish_time: number;
}

/**
 * Pyth 解析后的价格数据
 */
export interface PythParsedPriceData {
  /** 价格 ID */
  id: string;
  /** 当前价格信息 */
  price: PythPriceInfo;
  /** EMA 价格信息 */
  ema_price: PythPriceInfo;
  /** 价格元数据 */
  metadata: PythPriceMetadata;
}

/**
 * Pyth 二进制数据
 */
export interface PythBinaryData {
  /** 编码格式 */
  encoding: "hex";
  /** 二进制数据的十六进制字符串数组 */
  data: string[];
}

/**
 * Pyth 价格流式更新数据
 */
export interface PythPriceUpdate {
  /** 二进制数据（原始格式） */
  binary: PythBinaryData;
  /** 解析后的价格数据数组 */
  parsed: PythParsedPriceData[];
}

/**
 * Pyth 价格流式数据缓存项
 */
interface PythCachedItem {
  data: PythPriceUpdate;
  cachedAt: number;
}

/**
 * Pyth 价格数据回调函数类型
 */
export type PythDataCallback = (data: PythPriceUpdate) => void;

/**
 * Pyth 价格流式客户端配置选项
 */
interface PythClientOptions {
  /**
   * Pyth 价格 ID 列表
   */
  priceIds: string[];
  /**
   * 最大重连次数，默认为 5
   */
  maxReconnectAttempts?: number;
  /**
   * 重连延迟（毫秒），默认为 3000
   */
  reconnectDelay?: number;
  /**
   * 最大缓存数量，默认为 1000
   */
  maxCacheSize?: number;
  /**
   * 客户端名称，用于日志标识
   */
  name?: string;
}

/**
 * Pyth 价格流式客户端
 * 基于 Server-Sent Events (SSE) 实现价格数据的实时推送
 */
export class PythClient {
  private url: string;
  private name: string;
  private isConnected: boolean = false;
  private abortController: AbortController | null = null;
  private response: Response | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  // 缓存容器
  private cache: PythCachedItem[] = [];

  // 回调函数
  private dataCallback: PythDataCallback | null = null;

  // 重连相关
  private isManualDisconnect: boolean = false;
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectDelay: number;
  private readonly maxCacheSize: number;

  // 数据解析缓冲区
  private buffer: string = "";

  constructor(options: PythClientOptions) {
    // 构建 URL
    const priceIds = options.priceIds.map((id) => `ids[]=${encodeURIComponent(id)}`).join("&");
    this.url = `https://hermes.pyth.network/v2/updates/price/stream?${priceIds}`;

    this.name = options.name ?? "PythClient";
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.reconnectDelay = options.reconnectDelay ?? 3000;
    this.maxCacheSize = options.maxCacheSize ?? 1000;
  }

  /**
   * 设置数据回调函数
   */
  setDataCallback(callback: PythDataCallback | null): void {
    this.dataCallback = callback;
  }

  /**
   * 建立连接并开始接收数据
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      logInfo(`[${this.name}] 已连接，跳过重复连接`);
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.abortController = new AbortController();
        this.isManualDisconnect = false;
        this.reconnectAttempts = 0;

        // 发起 fetch 请求
        fetch(this.url, {
          signal: this.abortController.signal,
          headers: {
            Accept: "text/event-stream",
          },
        })
          .then((response) => {
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            if (!response.body) {
              throw new Error("响应体不存在");
            }

            this.response = response;
            this.isConnected = true;
            this.reader = response.body.getReader();
            const decoder = new TextDecoder();

            logInfo(`[${this.name}] 连接已建立`);

            // 开始读取流数据
            this.readStream(decoder);

            resolve();
          })
          .catch((error) => {
            this.isConnected = false;
            if (error.name === "AbortError") {
              logInfo(`[${this.name}] 连接被中止`);
              return;
            }

            logInfo(`[${this.name}] 连接失败: ${error}`);

            if (this.reconnectAttempts === 0) {
              reject(error);
            }

            // 如果不是主动断开，尝试重连
            if (!this.isManualDisconnect) {
              this.attemptReconnect();
            }
          });
      } catch (error) {
        logInfo(`[${this.name}] 连接异常: ${error}`);
        reject(error);
      }
    });
  }

  /**
   * 读取流数据
   */
  private async readStream(decoder: TextDecoder): Promise<void> {
    if (!this.reader) {
      return;
    }

    try {
      while (true) {
        const { done, value } = await this.reader.read();

        if (done) {
          logInfo(`[${this.name}] 流读取完成`);
          this.handleDisconnect();
          break;
        }

        // 解码数据并追加到缓冲区
        const chunk = decoder.decode(value, { stream: true });
        this.buffer += chunk;

        // 处理缓冲区中的数据（SSE 格式）
        this.processBuffer();
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        logInfo(`[${this.name}] 流读取被中止`);
        return;
      }

      logInfo(`[${this.name}] 流读取错误: ${error}`);
      this.handleDisconnect();
    }
  }

  /**
   * 处理缓冲区中的数据（SSE 格式）
   * SSE 格式：每行以 "data:" 开头，后跟 JSON 数据
   */
  private processBuffer(): void {
    const lines = this.buffer.split("\n");

    // 保留最后一行（可能不完整），处理其他行
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmedLine = line.trim();

      // 跳过空行和注释
      if (!trimmedLine || trimmedLine.startsWith(":")) {
        continue;
      }

      // 处理 data: 开头的行
      if (trimmedLine.startsWith("data:")) {
        const jsonStr = trimmedLine.substring(5).trim();

        if (!jsonStr) {
          continue;
        }

        try {
          const data: PythPriceUpdate = JSON.parse(jsonStr);
          this.handleData(data);
        } catch (error) {
          logInfo(`[${this.name}] JSON 解析失败: ${error}, 数据: ${jsonStr.substring(0, 100)}...`);
        }
      }
    }
  }

  /**
   * 处理接收到的数据
   */
  private handleData(data: PythPriceUpdate): void {
    // 缓存数据
    this.cacheItem(data);

    // 执行回调
    if (this.dataCallback) {
      try {
        this.dataCallback(data);
      } catch (error) {
        logInfo(`[${this.name}] 回调执行异常: ${error}`);
      }
    }
  }

  /**
   * 缓存数据项
   */
  private cacheItem(data: PythPriceUpdate): void {
    this.cache.push({
      data,
      cachedAt: Date.now(),
    });

    // 如果超出最大缓存数量，移除最旧的数据
    if (this.cache.length > this.maxCacheSize) {
      this.cache.shift();
    }
  }

  /**
   * 处理断开连接
   */
  private handleDisconnect(): void {
    this.isConnected = false;
    this.cleanup();

    if (!this.isManualDisconnect) {
      this.attemptReconnect();
    } else {
      logInfo(`[${this.name}] 主动断开连接，不进行重连`);
    }
  }

  /**
   * 尝试重连
   */
  private attemptReconnect(): void {
    if (this.isManualDisconnect) {
      logInfo(`[${this.name}] 已主动断开，不再尝试重连`);
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logInfo(`[${this.name}] 达到最大重连次数，停止重连`);
      return;
    }

    this.reconnectAttempts++;
    logInfo(
      `[${this.name}] ${this.reconnectDelay / 1000}秒后尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
    );

    setTimeout(() => {
      // 在真正重连前再次检查是否已经被主动断开
      if (this.isManualDisconnect) {
        logInfo(`[${this.name}] 已主动断开，取消本次重连`);
        return;
      }

      this.connect().catch((error) => {
        logInfo(`[${this.name}] 重连失败: ${error}`);
      });
    }, this.reconnectDelay);
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    // 取消读取器
    if (this.reader) {
      this.reader.cancel().catch(() => {
        // 忽略取消错误
      });
      this.reader = null;
    }

    // 中止请求
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.response = null;
    this.buffer = "";
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    // 标记为主动断开，阻止后续自动重连
    this.isManualDisconnect = true;

    if (!this.isConnected) {
      logInfo(`[${this.name}] 已是断开状态（主动关闭）`);
      return;
    }

    this.cleanup();
    this.isConnected = false;
    logInfo(`[${this.name}] 连接已断开`);
  }

  /**
   * 获取连接状态
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * 获取所有缓存数据
   */
  getCachedData(): PythPriceUpdate[] {
    return this.cache.map((item) => item.data);
  }

  /**
   * 获取最新的缓存数据
   */
  getLatestCached(): PythPriceUpdate | null {
    if (this.cache.length === 0) {
      return null;
    }
    return this.cache[this.cache.length - 1].data;
  }

  /**
   * 获取缓存数量
   */
  getCacheSize(): number {
    return this.cache.length;
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache = [];
  }
}

/**
 * 计算 Pyth 价格的实际数值
 * 公式：实际价格 = price * 10^expo
 * @param priceInfo 价格信息
 * @returns 实际价格数值
 */
export function calculatePythPrice(priceInfo: PythPriceInfo): number {
  const price = parseFloat(priceInfo.price);
  const expo = priceInfo.expo;
  return price * Math.pow(10, expo);
}

/**
 * 计算 Pyth 价格的置信区间
 * 公式：置信区间 = conf * 10^expo
 * @param priceInfo 价格信息
 * @returns 置信区间数值
 */
export function calculatePythConfidence(priceInfo: PythPriceInfo): number {
  const conf = parseFloat(priceInfo.conf);
  const expo = priceInfo.expo;
  return conf * Math.pow(10, expo);
}

// 测试用例：可以直接用 bun 命令运行
// 使用方法: bun src/app/crypto15min/utils/pythClient.ts
// @ts-expect-error - Bun 支持 import.meta.main，但 TypeScript CommonJS 配置不支持
if (import.meta.main) {
  // 默认的价格 ID（BTC/USD）
  const PRICE_ID = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

  const client = new PythClient({
    priceIds: [PRICE_ID],
    maxReconnectAttempts: 5,
    reconnectDelay: 3000,
    maxCacheSize: 100,
    name: "PythPriceTest",
  });

  // 设置回调函数，打印实时价格和延迟
  client.setDataCallback((data: PythPriceUpdate) => {
    const now = Date.now();
    const currentTime = Math.floor(now / 1000); // 转换为秒

    // 处理每个价格数据
    for (const priceData of data.parsed) {
      // 计算实际价格
      const actualPrice = calculatePythPrice(priceData.price);
      const emaPrice = calculatePythPrice(priceData.ema_price);
      const confidence = calculatePythConfidence(priceData.price);

      // 计算延迟（当前时间 - 发布时间，单位：毫秒）
      const publishTimeMs = priceData.price.publish_time * 1000;
      const delayMs = now - publishTimeMs;

      // 格式化时间
      const publishTime = new Date(publishTimeMs).toISOString();
      const receiveTime = new Date(now).toISOString();

      // 打印价格信息
      console.log("\n=== Pyth 价格更新 ===");
      console.log(`价格 ID: ${priceData.id}`);
      console.log(`实时价格: ${actualPrice.toFixed(8)}`);
      console.log(`EMA 价格: ${emaPrice.toFixed(8)}`);
      console.log(`置信区间: ${confidence.toFixed(8)}`);
      console.log(`发布时间: ${publishTime} (Unix: ${priceData.price.publish_time})`);
      console.log(`接收时间: ${receiveTime}`);
      console.log(`延迟: ${delayMs}ms (${(delayMs / 1000).toFixed(2)}s)`);
      console.log(`Slot: ${priceData.metadata.slot}`);
      console.log(`缓存数量: ${client.getCacheSize()}`);
      console.log("===================\n");
    }
  });

  // 连接并启动
  console.log(`正在连接到 Pyth Network...`);
  console.log(`价格 ID: ${PRICE_ID}`);
  console.log(`按 Ctrl+C 退出\n`);

  client
    .connect()
    .then(() => {
      console.log("连接成功，开始接收价格数据...\n");
    })
    .catch((error) => {
      console.error("连接失败:", error);
      process.exit(1);
    });

  // 处理退出信号
  process.on("SIGINT", () => {
    console.log("\n\n正在断开连接...");
    client.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\n\n正在断开连接...");
    client.disconnect();
    process.exit(0);
  });
}

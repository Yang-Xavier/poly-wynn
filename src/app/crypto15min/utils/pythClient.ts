import { polyLiveDataClient } from "./polyLiveData";

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
  receivedAt: number; // 数据接收时间（从服务器收到的时间）
  parsedAt: number; // 数据解析完成时间
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
      console.log(`[${this.name}] 已连接，跳过重复连接`);
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

            console.log(`[${this.name}] 连接已建立`);

            // 开始读取流数据
            this.readStream(decoder);

            resolve();
          })
          .catch((error) => {
            this.isConnected = false;
            if (error.name === "AbortError") {
              console.log(`[${this.name}] 连接被中止`);
              return;
            }

            console.log(`[${this.name}] 连接失败: ${error}`);

            if (this.reconnectAttempts === 0) {
              reject(error);
            }

            // 如果不是主动断开，尝试重连
            if (!this.isManualDisconnect) {
              this.attemptReconnect();
            }
          });
      } catch (error) {
        console.log(`[${this.name}] 连接异常: ${error}`);
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
          console.log(`[${this.name}] 流读取完成`);
          this.handleDisconnect();
          break;
        }

        // 记录数据块接收时间（从服务器接收到的时间）
        const chunkReceivedAt = Date.now();

        // 解码数据并追加到缓冲区
        const chunk = decoder.decode(value, { stream: true });
        this.buffer += chunk;

        // 处理缓冲区中的数据（SSE 格式），传入接收时间
        this.processBuffer(chunkReceivedAt);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.log(`[${this.name}] 流读取被中止`);
        return;
      }

      console.log(`[${this.name}] 流读取错误: ${error}`);
      this.handleDisconnect();
    }
  }

  /**
   * 处理缓冲区中的数据（SSE 格式）
   * SSE 格式：每行以 "data:" 开头，后跟 JSON 数据
   */
  private processBuffer(chunkReceivedAt: number): void {
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
          const parsedAt = Date.now();

          this.handleData(data, chunkReceivedAt, parsedAt);
        } catch (error) {
          console.log(
            `[${this.name}] JSON 解析失败: ${error}, 数据: ${jsonStr.substring(0, 100)}...`
          );
        }
      }
    }
  }

  /**
   * 处理接收到的数据
   */
  private handleData(data: PythPriceUpdate, receivedAt: number, parsedAt: number): void {
    // 缓存数据（包含时间戳信息）
    this.cacheItem(data, receivedAt, parsedAt);

    // 立即执行回调，不延迟
    if (this.dataCallback) {
      try {
        this.dataCallback(data);
      } catch (error) {
        console.log(`[${this.name}] 回调执行异常: ${error}`);
      }
    }
  }

  /**
   * 缓存数据项
   */
  private cacheItem(data: PythPriceUpdate, receivedAt: number, parsedAt: number): void {
    this.cache.push({
      data,
      cachedAt: Date.now(),
      receivedAt,
      parsedAt,
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
      console.log(`[${this.name}] 主动断开连接，不进行重连`);
    }
  }

  /**
   * 尝试重连
   */
  private attemptReconnect(): void {
    if (this.isManualDisconnect) {
      console.log(`[${this.name}] 已主动断开，不再尝试重连`);
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log(`[${this.name}] 达到最大重连次数，停止重连`);
      return;
    }

    this.reconnectAttempts++;
    console.log(
      `[${this.name}] ${this.reconnectDelay / 1000}秒后尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
    );

    setTimeout(() => {
      // 在真正重连前再次检查是否已经被主动断开
      if (this.isManualDisconnect) {
        console.log(`[${this.name}] 已主动断开，取消本次重连`);
        return;
      }

      this.connect().catch((error) => {
        console.log(`[${this.name}] 重连失败: ${error}`);
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
      console.log(`[${this.name}] 已是断开状态（主动关闭）`);
      return;
    }

    this.cleanup();
    this.isConnected = false;
    console.log(`[${this.name}] 连接已断开`);
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
   * 获取最新缓存项的完整信息（包含时间戳）
   */
  getLatestCachedItem(): PythCachedItem | null {
    if (this.cache.length === 0) {
      return null;
    }
    return this.cache[this.cache.length - 1];
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

// 默认的价格 ETH/USD
const PRICE_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
// Chainlink 交易对符号
const CHAINLINK_SYMBOL = "eth/usd";

// 存储最新的价格数据，用于对比
let latestPythPrice: { price: number; timestamp: number } | null = null;
let latestChainlinkPrice: { price: number; timestamp: number } | null = null;

/**
 * 对比两个价格源的价格
 */
const comparePrices = () => {
  if (!latestPythPrice || !latestChainlinkPrice) {
    return;
  }

  const priceDiff = latestPythPrice.price - latestChainlinkPrice.price;
  const priceDiffPercent = (priceDiff / latestChainlinkPrice.price) * 100;
  const timeDiff = latestPythPrice.timestamp - latestChainlinkPrice.timestamp;

  console.log("\n=== 价格对比 ===");
  console.log(
    `Pyth 价格: ${latestPythPrice.price.toFixed(8)} (时间戳: ${latestPythPrice.timestamp})`
  );
  console.log(
    `Chainlink 价格: ${latestChainlinkPrice.price.toFixed(8)} (时间戳: ${latestChainlinkPrice.timestamp})`
  );
  console.log(
    `价格差异: ${priceDiff.toFixed(8)} (${priceDiffPercent > 0 ? "+" : ""}${priceDiffPercent.toFixed(4)}%)`
  );
  console.log(
    `时间戳差异 (Pyth - Chainlink): ${timeDiff.toFixed(2)}ms ${timeDiff > 0 ? "(Pyth 更晚)" : timeDiff < 0 ? "(Chainlink 更晚)" : "(相同)"}`
  );
  console.log("===================\n");
};

// 创建 Pyth 客户端
const pythClient = new PythClient({
  priceIds: [PRICE_ID],
  maxReconnectAttempts: 5,
  reconnectDelay: 3000,
  maxCacheSize: 100,
  name: "PythPriceTest",
});

// 设置 Pyth 回调函数
pythClient.setDataCallback((data: PythPriceUpdate) => {
  const callbackStartTime = Date.now();
  const cacheItem = pythClient.getLatestCachedItem();

  // 处理每个价格数据
  for (const priceData of data.parsed) {
    // 计算实际价格
    const actualPrice = calculatePythPrice(priceData.price);
    const emaPrice = calculatePythPrice(priceData.ema_price);
    const confidence = calculatePythConfidence(priceData.price);

    // 更新时间戳
    const publishTimeMs = priceData.price.publish_time * 1000;
    const receivedAt = cacheItem?.receivedAt || callbackStartTime;
    const parsedAt = cacheItem?.parsedAt || callbackStartTime;
    const callbackAt = callbackStartTime;
    const now = Date.now();

    // 更新最新 Pyth 价格
    latestPythPrice = {
      price: actualPrice,
      timestamp: publishTimeMs,
    };

    // 计算各种延迟
    const publishToReceivedDelay = receivedAt - publishTimeMs;
    const receivedToParsedDelay = parsedAt - receivedAt;
    const parsedToCallbackDelay = callbackAt - parsedAt;
    const totalDelay = now - publishTimeMs;

    // 格式化时间
    const publishTime = new Date(publishTimeMs).toISOString();
    const receiveTime = new Date(receivedAt).toISOString();
    const parseTime = new Date(parsedAt).toISOString();
    const callbackTime = new Date(callbackAt).toISOString();

    // 打印 Pyth 价格信息
    console.log("\n=== Pyth 价格更新 ===");

    console.log(`价格 ID: ${priceData.id}`);
    console.log(`实时价格: ${actualPrice.toFixed(8)}`);
    console.log(`EMA 价格: ${emaPrice.toFixed(8)}`);
    console.log(`置信区间: ${confidence.toFixed(8)}`);
    console.log(`\n时间戳分析:`);
    console.log(`  发布时间: ${publishTime} (Unix: ${priceData.price.publish_time})`);
    console.log(`  接收时间: ${receiveTime}`);
    console.log(`  解析时间: ${parseTime}`);
    console.log(`  回调时间: ${callbackTime}`);
    console.log(`\n延迟分析:`);
    console.log(`  发布→接收延迟: ${publishToReceivedDelay.toFixed(2)}ms (网络传输)`);
    console.log(`  接收→解析延迟: ${receivedToParsedDelay.toFixed(2)}ms (数据处理)`);
    console.log(`  解析→回调延迟: ${parsedToCallbackDelay.toFixed(2)}ms (回调调度)`);
    console.log(`  总延迟: ${totalDelay.toFixed(2)}ms (${(totalDelay / 1000).toFixed(2)}s)`);
    console.log(`\n其他信息:`);
    console.log(`  Slot: ${priceData.metadata.slot}`);
    console.log(
      `  证明可用时间: ${new Date(priceData.metadata.proof_available_time * 1000).toISOString()}`
    );
    console.log(`  缓存数量: ${pythClient.getCacheSize()}`);

    // 在回调函数中直接打印价格差异
    if (latestChainlinkPrice) {
      const priceDiff = actualPrice - latestChainlinkPrice.price;
      const priceDiffPercent = (priceDiff / latestChainlinkPrice.price) * 100;
      const timeDiff = publishTimeMs - latestChainlinkPrice.timestamp;

      console.log(`\n价格对比 (Pyth vs Chainlink):`);
      console.log(`  Pyth 价格: ${actualPrice.toFixed(8)}`);
      console.log(`  Chainlink 价格: ${latestChainlinkPrice.price.toFixed(8)}`);
      console.log(
        `  价格差异: ${priceDiff.toFixed(8)} (${priceDiffPercent > 0 ? "+" : ""}${priceDiffPercent.toFixed(4)}%)`
      );
      console.log(
        `  时间戳差异 (Pyth - Chainlink): ${timeDiff.toFixed(2)}ms ${timeDiff > 0 ? "(Pyth 更晚)" : timeDiff < 0 ? "(Chainlink 更晚)" : "(相同)"}`
      );
    } else {
      console.log(`\n价格对比: Chainlink 价格尚未更新，无法对比`);
    }

    console.log("===================\n");

    // 进行价格对比（保留原有函数调用）
    comparePrices();
  }
});

// 设置 Chainlink (PolyLiveData) 回调函数
polyLiveDataClient.onWatchPriceChange((price, historyPriceList) => {
  const now = Date.now();
  const delay = now - price.timestamp;

  // 更新最新 Chainlink 价格
  latestChainlinkPrice = {
    price: price.value,
    timestamp: price.timestamp,
  };

  // 打印 Chainlink 价格信息
  console.log("\n=== Chainlink 价格更新 ===");
  console.log(`价格: ${price.value.toFixed(8)}`);
  console.log(`时间戳: ${price.timestamp} (${new Date(price.timestamp).toISOString()})`);
  console.log(`延迟: ${delay}ms`);
  console.log(`历史价格数量: ${historyPriceList.length}`);

  // 在回调函数中直接打印价格差异
  if (latestPythPrice) {
    const priceDiff = latestPythPrice.price - price.value;
    const priceDiffPercent = (priceDiff / price.value) * 100;
    const timeDiff = latestPythPrice.timestamp - price.timestamp;

    console.log(`\n价格对比 (Chainlink vs Pyth):`);
    console.log(`  Chainlink 价格: ${price.value.toFixed(8)}`);
    console.log(`  Pyth 价格: ${latestPythPrice.price.toFixed(8)}`);
    console.log(
      `  价格差异: ${priceDiff.toFixed(8)} (${priceDiffPercent > 0 ? "+" : ""}${priceDiffPercent.toFixed(4)}%)`
    );
    console.log(
      `  时间戳差异 (Pyth - Chainlink): ${timeDiff.toFixed(2)}ms ${timeDiff > 0 ? "(Pyth 更晚)" : timeDiff < 0 ? "(Chainlink 更晚)" : "(相同)"}`
    );
  } else {
    console.log(`\n价格对比: Pyth 价格尚未更新，无法对比`);
  }

  console.log("===================\n");

  // 进行价格对比（保留原有函数调用）
  comparePrices();
});

// 连接并启动两个客户端
console.log(`正在连接到 Pyth Network 和 Polymarket Chainlink...`);
console.log(`Pyth 价格 ID: ${PRICE_ID}`);
console.log(`Chainlink 交易对: ${CHAINLINK_SYMBOL}`);
console.log(`按 Ctrl+C 退出\n`);

// 同时连接两个客户端
Promise.all([
  pythClient.connect().then(() => {
    console.log("Pyth Network 连接成功，开始接收价格数据...\n");
  }),
  polyLiveDataClient.connect().then(() => {
    console.log("Polymarket Chainlink 连接成功，开始订阅价格数据...\n");
    polyLiveDataClient.subscribeCryptoPrices(CHAINLINK_SYMBOL);
  }),
]).catch((error) => {
  console.error("连接失败:", error);
  process.exit(1);
});

// 处理退出信号
const cleanup = () => {
  console.log("\n\n正在断开连接...");
  pythClient.disconnect();
  polyLiveDataClient.disconnect();
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

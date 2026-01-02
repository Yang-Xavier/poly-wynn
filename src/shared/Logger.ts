import * as fs from "fs";
import * as path from "path";

// 日志级别枚举
export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

// Logger配置接口
export interface LoggerConfig {
  logDir?: string; // 日志目录，默认为 './logs'
  traceId?: string; // 追踪ID，所有日志都会包含此ID
  enableConsole?: boolean; // 是否输出到控制台，默认为 true
  appName?: string; // 应用名称，用于区分日志文件名，默认为 'app'
  flushInterval?: number; // 自动刷新间隔（毫秒），在进程空闲时批量写入，默认为 2000
}

// 默认配置
const DEFAULT_CONFIG: Required<Omit<LoggerConfig, "traceId" | "appName">> & {
  traceId?: string;
  appName?: string;
} = {
  logDir: "./logs",
  enableConsole: false,
  flushInterval: 2000, // 2秒自动刷新，在进程空闲时批量写入
};

// 日志项接口
interface LogItem {
  message: string;
  type?: string;
}

/**
 * 基础Logger类 - 支持日志级别、traceId和本地文件保存
 *
 * 性能优化特性：
 * - 日志先入队，不立即写入文件，避免阻塞主线程
 * - 在进程空闲阶段（使用 setImmediate）批量写入文件
 * - 定时批量刷新（默认2秒），确保日志及时持久化
 * - 支持背压处理，当文件写入缓冲区满时自动等待
 *
 * 适用于高频日志场景，确保主线任务性能不受影响
 */
export class Logger {
  private config: Required<Omit<LoggerConfig, "traceId" | "appName">> & {
    traceId?: string;
    appName?: string;
  };
  private fileStreams: Map<string, fs.WriteStream> = new Map(); // 存储不同 type 的文件流
  private streamDates: Map<string, string> = new Map(); // 存储每个 type 对应的当前日期
  private traceId: string | undefined;
  private logQueue: Map<string, LogItem[]> = new Map(); // 按 type 分组的日志队列
  private flushTimer: NodeJS.Timeout | null = null; // 自动刷新定时器
  private isFlushing: boolean = false; // 是否正在刷新
  private pendingFlush: NodeJS.Immediate | null = null; // 待执行的空闲刷新任务

  constructor(config?: LoggerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.traceId = config?.traceId;

    // 确保日志目录存在
    if (!fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
    }

    // 启动自动刷新定时器
    this.startAutoFlush();
  }

  /**
   * 获取当前日期的文件夹名称（格式：YYYY-MM-DD）
   * 按照北京时区（UTC+8）进行划分
   */
  private getDateFolderName(): string {
    const now = new Date();
    // 转换为北京时区（UTC+8）
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    // 使用 UTC 方法获取北京时区的年月日
    const year = beijingTime.getUTCFullYear();
    const month = String(beijingTime.getUTCMonth() + 1).padStart(2, "0");
    const day = String(beijingTime.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /**
   * 获取日志文件的完整路径（包含 appName、日期文件夹和 traceId 文件夹）
   * 目录结构：appName/date/traceId/type.log
   * @param dateFolder 日期文件夹名称
   * @param traceId 追踪ID，用于创建 traceId 子目录
   * @param type 日志类型，用于区分不同的日志文件
   */
  private getLogFilePath(dateFolder: string, traceId: string | undefined, type?: string): string {
    // appName 目录，如果没有 appName 则使用 "default"
    const appNameDir = path.join(this.config.logDir, this.config.appName || "default");
    // 日期目录
    const dateDir = path.join(appNameDir, dateFolder);
    // traceId 目录，如果没有 traceId 则使用 "default"
    const traceIdDir = path.join(dateDir, traceId || "default");
    // 确保所有目录都存在
    if (!fs.existsSync(traceIdDir)) {
      fs.mkdirSync(traceIdDir, { recursive: true });
    }
    // 根据 type 生成日志文件名
    let logFileName: string;
    if (type) {
      // 如果有 type，文件名格式：${type}.log
      logFileName = `${type}.log`;
    } else {
      // 如果没有 type，使用 "app.log"
      logFileName = "app.log";
    }
    return path.join(traceIdDir, logFileName);
  }

  /**
   * 生成 streamKey，格式：${traceId || 'default'}_${type || 'default'}
   * @param traceId 追踪ID
   * @param type 日志类型
   */
  private getStreamKey(traceId: string | undefined, type?: string): string {
    const traceIdPart = traceId || "default";
    const typePart = type || "default";
    return `${traceIdPart}_${typePart}`;
  }

  /**
   * 从 streamKey 解析出 traceId 和 type
   * @param streamKey streamKey
   * @returns [traceId, type]
   */
  private parseStreamKey(streamKey: string): [string | undefined, string | undefined] {
    const parts = streamKey.split("_");
    if (parts.length < 2) {
      return [undefined, undefined];
    }
    const traceId = parts[0] === "default" ? undefined : parts[0];
    const type = parts.slice(1).join("_") === "default" ? undefined : parts.slice(1).join("_");
    return [traceId, type];
  }

  /**
   * 获取或创建指定 traceId 和 type 的日志文件流
   * @param traceId 追踪ID
   * @param type 日志类型
   */
  private getOrCreateLogStream(traceId: string | undefined, type?: string): fs.WriteStream {
    const streamKey = this.getStreamKey(traceId, type);
    const date = this.getDateFolderName();
    const currentDate = this.streamDates.get(streamKey);

    // 如果日期变化或文件流不存在，需要重新创建
    // streamKey 已经包含了 traceId 信息，所以不需要单独检查 traceId
    if (!currentDate || currentDate !== date || !this.fileStreams.has(streamKey)) {
      // 如果已存在文件流，先关闭它
      const existingStream = this.fileStreams.get(streamKey);
      if (existingStream) {
        existingStream.end();
      }

      // 创建新的文件流
      const logFilePath = this.getLogFilePath(date, traceId, type);
      const newStream = fs.createWriteStream(logFilePath, { flags: "a" });
      this.fileStreams.set(streamKey, newStream);
      this.streamDates.set(streamKey, date);
      return newStream;
    }

    return this.fileStreams.get(streamKey)!;
  }

  /**
   * 格式化日志消息
   */
  private formatMessage(level: LogLevel, message: string, data?: any, type?: string): string {
    // 使用中国北京时区（东八区），显示为 "YYYY-MM-DD HH:mm:ss.SSS 北京时间"
    const date = new Date();
    const utc8Date = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    const timestamp = utc8Date.toISOString().replace("T", " ").replace("Z", " 北京时间");

    const traceIdStr = this.traceId ? ` [TraceID: ${this.traceId}]` : "";
    const typeStr = type ? ` [Type: ${type}]` : "";
    const dataStr = data ? ` | Data: ${JSON.stringify(data)}` : "";

    return `[${timestamp}] ${typeStr} [${level}] ${traceIdStr} => ${message}${dataStr}`;
  }

  /**
   * 启动自动刷新定时器
   * 在进程空闲时定期批量写入日志到文件
   */
  private startAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    // 使用 setInterval 定期触发，但实际写入在进程空闲时执行
    this.flushTimer = setInterval(() => {
      // 如果有待处理的日志，在空闲时刷新
      if (this.logQueue.size > 0 && !this.isFlushing) {
        // 使用 setImmediate 确保在进程空闲阶段执行
        setImmediate(() => {
          this.flush();
        });
      }
    }, this.config.flushInterval);
  }

  /**
   * 将日志添加到队列（异步，不阻塞）
   * 日志不会立即写入文件，而是在进程空闲时批量写入
   * @param formattedMessage 格式化后的日志消息
   * @param type 日志类型
   */
  private enqueueLog(formattedMessage: string, type?: string): void {
    // queueKey 需要包含 traceId，格式：${traceId || 'default'}_${type || 'default'}
    const queueKey = this.getStreamKey(this.traceId, type);
    if (!this.logQueue.has(queueKey)) {
      this.logQueue.set(queueKey, []);
    }
    this.logQueue.get(queueKey)!.push({ message: formattedMessage, type });

    // 在进程空闲时触发刷新（如果还没有待执行的刷新任务）
    // 使用 setImmediate 确保在事件循环空闲阶段执行，不阻塞主线程
    if (!this.pendingFlush) {
      this.pendingFlush = setImmediate(() => {
        this.pendingFlush = null;
        // 在空闲时刷新，但只在有日志时才执行
        if (this.logQueue.size > 0) {
          this.flush();
        }
      });
    }
  }

  /**
   * 刷新日志队列到文件（异步批量写入）
   * @param specificType 如果指定，只刷新该类型的队列
   */
  private flush(specificType?: string): void {
    // 如果正在刷新，跳过（避免并发问题）
    if (this.isFlushing) {
      return;
    }

    this.isFlushing = true;

    // 使用 setImmediate 确保在下一个事件循环中执行，不阻塞主线程
    setImmediate(() => {
      try {
        const typesToFlush = specificType ? [specificType] : Array.from(this.logQueue.keys());

        let hasBackpressure = false;

        for (const queueKey of typesToFlush) {
          const queue = this.logQueue.get(queueKey);
          if (!queue || queue.length === 0) {
            continue;
          }

          // 从 queueKey 解析出 traceId 和 type
          const [traceId, type] = this.parseStreamKey(queueKey);
          const stream = this.getOrCreateLogStream(traceId, type);

          // 批量写入所有日志
          const messages = queue.map((item) => item.message + "\n").join("");
          const canWrite = stream.write(messages);

          // 如果写入缓冲区已满，等待 drain 事件
          if (!canWrite) {
            hasBackpressure = true;
            // 数据已写入缓冲区，清空队列
            this.logQueue.set(queueKey, []);
            // 设置 drain 事件监听器，等待缓冲区有空间后继续
            stream.once("drain", () => {
              this.isFlushing = false;
              // 继续刷新，处理可能新加入的日志
              this.flush();
            });
            // 跳出循环，等待 drain 事件
            break;
          }

          // 清空已写入的队列
          this.logQueue.set(queueKey, []);
        }

        // 如果没有遇到背压，重置刷新状态
        if (!hasBackpressure) {
          this.isFlushing = false;
        }
      } catch (error) {
        // 错误处理：如果写入失败，至少输出到控制台
        if (this.config.enableConsole) {
          console.error("日志写入失败:", error);
        }
        this.isFlushing = false;
      }
    });
  }

  /**
   * 写入日志到文件（已废弃，使用 enqueueLog 代替）
   * @deprecated 使用 enqueueLog 代替，以实现异步批量写入
   */
  private writeToFile(formattedMessage: string, type?: string): void {
    this.enqueueLog(formattedMessage, type);
  }

  /**
   * 通用日志方法
   * @param level 日志级别
   * @param message 日志消息
   * @param data 可选数据
   * @param type 可选日志类型，用于区分不同的日志文件
   */
  private log(level: LogLevel, message: string, data?: any, type?: string): void {
    const formattedMessage = this.formatMessage(level, message, data, type);

    // 输出到控制台
    if (this.config.enableConsole) {
      if (level === LogLevel.ERROR) {
        console.error(formattedMessage);
      } else if (level === LogLevel.WARN) {
        console.warn(formattedMessage);
      } else {
        console.log(formattedMessage);
      }
    }

    // 写入到文件
    this.writeToFile(formattedMessage, type);
  }

  /**
   * Debug级别日志
   * @param message 日志消息
   * @param data 可选数据
   * @param type 可选日志类型，用于区分不同的日志文件
   */
  debug(message: string, data?: any, type?: string): void {
    this.log(LogLevel.DEBUG, message, data, type);
  }

  /**
   * Info级别日志
   * @param message 日志消息
   * @param data 可选数据
   * @param type 可选日志类型，用于区分不同的日志文件
   */
  info(message: string, data?: any, type?: string): void {
    this.log(LogLevel.INFO, message, data, type);
  }

  /**
   * Warn级别日志
   * @param message 日志消息
   * @param data 可选数据
   * @param type 可选日志类型，用于区分不同的日志文件
   */
  warn(message: string, data?: any, type?: string): void {
    this.log(LogLevel.WARN, message, data, type);
  }

  /**
   * Error级别日志
   * @param message 日志消息
   * @param data 可选数据
   * @param type 可选日志类型，用于区分不同的日志文件
   */
  error(message: string, data?: any, type?: string): void {
    this.log(LogLevel.ERROR, message, data, type);
  }

  /**
   * 设置或更新 traceId
   * 当 traceId 变化时，会关闭所有旧的文件流，新的日志将写入到新的 traceId 目录下
   */
  setTraceId(traceId: string): void {
    const oldTraceId = this.traceId;
    if (oldTraceId === traceId) {
      return; // traceId 没有变化，不需要做任何处理
    }

    this.traceId = traceId;

    // 如果 traceId 变化，需要关闭所有旧的文件流
    // 因为新的日志应该写入到新的 traceId 目录下
    // 关闭所有与旧 traceId 相关的文件流
    const streamsToClose: string[] = [];
    for (const streamKey of this.fileStreams.keys()) {
      const [streamTraceId] = this.parseStreamKey(streamKey);
      // 比较时，如果 oldTraceId 是 undefined，则 streamTraceId 也应该是 undefined（即 "default"）
      if (
        (oldTraceId === undefined && streamTraceId === undefined) ||
        streamTraceId === oldTraceId
      ) {
        streamsToClose.push(streamKey);
      }
    }

    // 先刷新这些流中的日志
    for (const streamKey of streamsToClose) {
      const queue = this.logQueue.get(streamKey);
      if (queue && queue.length > 0) {
        const [traceIdForStream, type] = this.parseStreamKey(streamKey);
        const stream = this.getOrCreateLogStream(traceIdForStream, type);
        const messages = queue.map((item) => item.message + "\n").join("");
        stream.write(messages);
        this.logQueue.set(streamKey, []);
      }
    }

    // 关闭旧的文件流
    for (const streamKey of streamsToClose) {
      const stream = this.fileStreams.get(streamKey);
      if (stream) {
        stream.end();
        this.fileStreams.delete(streamKey);
        this.streamDates.delete(streamKey);
      }
    }
  }

  /**
   * 获取当前 traceId
   */
  getTraceId(): string | undefined {
    return this.traceId;
  }

  /**
   * 关闭所有文件流
   */
  close(): void {
    // 停止自动刷新定时器
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // 取消待执行的空闲刷新任务
    if (this.pendingFlush) {
      clearImmediate(this.pendingFlush);
      this.pendingFlush = null;
    }

    // 刷新所有剩余的日志
    this.flush();

    // 等待一小段时间确保所有日志都已写入
    // 注意：这是一个同步等待，但通常很快
    const startTime = Date.now();
    while (this.isFlushing && Date.now() - startTime < 1000) {
      // 等待最多1秒
    }

    // 关闭所有文件流
    for (const [key, stream] of this.fileStreams.entries()) {
      stream.end();
    }
    this.fileStreams.clear();
    this.streamDates.clear();
    this.logQueue.clear();
  }

  /**
   * 清理指定天数之前的日志文件
   * 目录结构：appName/date/traceId/type.log
   * @param days 保留最近N天的日志，N天之前的日志将被删除
   * @returns 返回被删除的日期文件夹数量
   */
  cleanOldLogs(days: number): number {
    if (days < 0) {
      throw new Error("days参数必须大于等于0");
    }

    // 如果日志目录不存在，直接返回
    if (!fs.existsSync(this.config.logDir)) {
      return 0;
    }

    // 获取北京时区的当前日期（UTC+8）
    const now = new Date();
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    // 设置为北京时区当天的0点（UTC时间）
    const currentDate = new Date(
      Date.UTC(
        beijingTime.getUTCFullYear(),
        beijingTime.getUTCMonth(),
        beijingTime.getUTCDate(),
        0,
        0,
        0,
        0
      )
    );
    // 转换回UTC时间戳（减去8小时偏移）
    const beijingMidnight = currentDate.getTime() - 8 * 60 * 60 * 1000;
    const cutoffTime = beijingMidnight - days * 24 * 60 * 60 * 1000; // 截止时间戳

    let deletedCount = 0;
    const currentDateFolder = this.getDateFolderName();

    try {
      // 读取日志目录下的所有文件和文件夹（appName 目录）
      const appEntries = fs.readdirSync(this.config.logDir, { withFileTypes: true });

      for (const appEntry of appEntries) {
        // 只处理目录（appName 目录）
        if (!appEntry.isDirectory()) {
          continue;
        }

        const appNamePath = path.join(this.config.logDir, appEntry.name);

        // 读取 appName 目录下的所有文件和文件夹（日期目录）
        const dateEntries = fs.readdirSync(appNamePath, { withFileTypes: true });

        for (const dateEntry of dateEntries) {
          // 只处理目录（日期目录）
          if (!dateEntry.isDirectory()) {
            continue;
          }

          const folderName = dateEntry.name;
          // 检查文件夹名称是否符合日期格式 YYYY-MM-DD
          const dateMatch = folderName.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (!dateMatch) {
            // 如果不是日期格式的文件夹，跳过
            continue;
          }

          // 如果是要删除的文件夹是当前使用的日志文件夹，跳过
          if (folderName === currentDateFolder) {
            continue;
          }

          // 解析日期（按北京时区解析）
          const year = parseInt(dateMatch[1], 10);
          const month = parseInt(dateMatch[2], 10) - 1; // 月份从0开始
          const day = parseInt(dateMatch[3], 10);

          // 创建北京时区当天的0点（使用UTC时间表示）
          const folderDate = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
          // 转换为UTC时间戳（减去8小时偏移，使其对应北京时区的0点）
          const folderDateUTC = folderDate.getTime() - 8 * 60 * 60 * 1000;

          // 如果文件夹日期早于截止时间，删除该文件夹
          if (folderDateUTC < cutoffTime) {
            const folderPath = path.join(appNamePath, folderName);

            try {
              // 递归删除文件夹及其内容
              fs.rmSync(folderPath, { recursive: true, force: true });
              deletedCount++;
              this.info(`已删除旧日志文件夹: ${appEntry.name}/${folderName}`);
            } catch (error) {
              this.error(`删除日志文件夹失败: ${appEntry.name}/${folderName}`, {
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      }
    } catch (error) {
      this.error("清理旧日志时发生错误", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    return deletedCount;
  }
}

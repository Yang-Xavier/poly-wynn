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
}

// 默认配置
const DEFAULT_CONFIG: Required<Omit<LoggerConfig, "traceId" | "appName">> & {
  traceId?: string;
  appName?: string;
} = {
  logDir: "./logs",
  enableConsole: false,
};

/**
 * 基础Logger类 - 支持日志级别、traceId和本地文件保存
 */
export class Logger {
  private config: Required<Omit<LoggerConfig, "traceId" | "appName">> & {
    traceId?: string;
    appName?: string;
  };
  private fileStreams: Map<string, fs.WriteStream> = new Map(); // 存储不同 type 的文件流
  private streamDates: Map<string, string> = new Map(); // 存储每个 type 对应的当前日期
  private traceId: string | undefined;

  constructor(config?: LoggerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 确保日志目录存在
    if (!fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
    }
  }

  /**
   * 获取当前日期的文件夹名称（格式：YYYY-MM-DD）
   */
  private getDateFolderName(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /**
   * 获取日志文件的完整路径（包含日期文件夹）
   * @param dateFolder 日期文件夹名称
   * @param type 日志类型，用于区分不同的日志文件
   */
  private getLogFilePath(dateFolder: string, type?: string): string {
    const dateDir = path.join(this.config.logDir, dateFolder);
    // 确保日期文件夹存在
    if (!fs.existsSync(dateDir)) {
      fs.mkdirSync(dateDir, { recursive: true });
    }
    // 根据 appName 和 type 生成日志文件名
    let logFileName: string;
    if (type) {
      // 如果有 type，文件名格式：${appName}_${type}.log 或 ${type}.log
      logFileName = this.config.appName ? `${this.config.appName}_${type}.log` : `${type}.log`;
    } else {
      // 如果没有 type，使用原来的逻辑
      logFileName = this.config.appName ? `${this.config.appName}.log` : "app.log";
    }
    return path.join(dateDir, logFileName);
  }

  /**
   * 获取或创建指定 type 的日志文件流
   * @param type 日志类型
   */
  private getOrCreateLogStream(type?: string): fs.WriteStream {
    const streamKey = type || "default";
    const date = this.getDateFolderName();
    const currentDate = this.streamDates.get(streamKey);

    // 如果日期变化或文件流不存在，需要重新创建
    if (!currentDate || currentDate !== date || !this.fileStreams.has(streamKey)) {
      // 如果已存在文件流，先关闭它
      const existingStream = this.fileStreams.get(streamKey);
      if (existingStream) {
        existingStream.end();
      }

      // 创建新的文件流
      const logFilePath = this.getLogFilePath(date, type);
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
   * 写入日志到文件
   * @param formattedMessage 格式化后的日志消息
   * @param type 日志类型
   */
  private writeToFile(formattedMessage: string, type?: string): void {
    const stream = this.getOrCreateLogStream(type);
    stream.write(formattedMessage + "\n");
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
   */
  setTraceId(traceId: string): void {
    this.traceId = traceId;
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
    // 关闭所有文件流
    for (const [key, stream] of this.fileStreams.entries()) {
      stream.end();
    }
    this.fileStreams.clear();
    this.streamDates.clear();
  }

  /**
   * 清理指定天数之前的日志文件
   * @param days 保留最近N天的日志，N天之前的日志将被删除
   * @returns 返回被删除的日志文件夹数量
   */
  cleanOldLogs(days: number): number {
    if (days < 0) {
      throw new Error("days参数必须大于等于0");
    }

    // 如果日志目录不存在，直接返回
    if (!fs.existsSync(this.config.logDir)) {
      return 0;
    }

    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0); // 设置为当天0点
    const cutoffTime = currentDate.getTime() - days * 24 * 60 * 60 * 1000; // 截止时间戳

    let deletedCount = 0;

    try {
      // 读取日志目录下的所有文件和文件夹
      const entries = fs.readdirSync(this.config.logDir, { withFileTypes: true });

      for (const entry of entries) {
        // 只处理目录
        if (!entry.isDirectory()) {
          continue;
        }

        const folderName = entry.name;
        // 检查文件夹名称是否符合日期格式 YYYY-MM-DD
        const dateMatch = folderName.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!dateMatch) {
          // 如果不是日期格式的文件夹，跳过
          continue;
        }

        // 解析日期
        const year = parseInt(dateMatch[1], 10);
        const month = parseInt(dateMatch[2], 10) - 1; // 月份从0开始
        const day = parseInt(dateMatch[3], 10);

        const folderDate = new Date(year, month, day);
        folderDate.setHours(0, 0, 0, 0);

        // 如果文件夹日期早于截止时间，删除该文件夹
        if (folderDate.getTime() < cutoffTime) {
          const folderPath = path.join(this.config.logDir, folderName);

          // 如果是要删除的文件夹是当前使用的日志文件夹，跳过
          const currentDate = this.getDateFolderName();
          if (folderName === currentDate) {
            continue;
          }

          try {
            // 递归删除文件夹及其内容
            fs.rmSync(folderPath, { recursive: true, force: true });
            deletedCount++;
            this.info(`已删除旧日志文件夹: ${folderName}`);
          } catch (error) {
            this.error(`删除日志文件夹失败: ${folderName}`, {
              error: error instanceof Error ? error.message : String(error),
            });
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

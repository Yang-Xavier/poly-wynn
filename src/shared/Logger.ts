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
}

// 默认配置
const DEFAULT_CONFIG: Required<Omit<LoggerConfig, "traceId">> & { traceId?: string } = {
  logDir: "./logs",
  enableConsole: true,
};

/**
 * 基础Logger类 - 支持日志级别、traceId和本地文件保存
 */
export class Logger {
  private static instance: Logger | null = null;
  private config: Required<Omit<LoggerConfig, "traceId">> & { traceId?: string };
  private fileStream: fs.WriteStream | null = null;
  private traceId: string | undefined;
  private currentDate: string = ""; // 当前日期文件夹名称

  private constructor(config?: LoggerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 确保日志目录存在
    if (!fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
    }

    // 初始化当前日期
    this.currentDate = this.getDateFolderName();

    // 创建文件流
    this.createLogStream();
  }

  /**
   * 获取Logger单例实例
   * @param config 可选配置，仅在第一次调用时生效
   * @returns Logger单例实例
   */
  public static getInstance(config?: LoggerConfig): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(config);
    }
    return Logger.instance;
  }

  /**
   * 创建新的Logger实例（非单例）
   * @param config 配置
   * @returns Logger实例
   */
  public static create(config?: LoggerConfig): Logger {
    return new Logger(config);
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
   */
  private getLogFilePath(dateFolder: string): string {
    const dateDir = path.join(this.config.logDir, dateFolder);
    // 确保日期文件夹存在
    if (!fs.existsSync(dateDir)) {
      fs.mkdirSync(dateDir, { recursive: true });
    }
    return path.join(dateDir, "app.log");
  }

  /**
   * 创建日志文件流
   */
  private createLogStream(): void {
    const date = this.getDateFolderName();
    const logFilePath = this.getLogFilePath(date);

    // 如果已存在文件流，先关闭它
    if (this.fileStream) {
      this.fileStream.end();
    }

    // 以追加模式打开日志文件
    this.fileStream = fs.createWriteStream(logFilePath, { flags: "a" });
  }

  /**
   * 格式化日志消息
   */
  private formatMessage(level: LogLevel, message: string, data?: any): string {
    // 使用中国北京时区（东八区），显示为 "YYYY-MM-DD HH:mm:ss.SSS 北京时间"
    const date = new Date();
    const utc8Date = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    const timestamp = utc8Date.toISOString().replace("T", " ").replace("Z", " 北京时间");

    const traceIdStr = this.traceId ? ` [TraceID: ${this.traceId}]` : "";
    const dataStr = data ? ` | Data: ${JSON.stringify(data)}` : "";

    return `[${timestamp}] [${level}]${traceIdStr} ${message}${dataStr}`;
  }

  /**
   * 写入日志到文件
   */
  private writeToFile(formattedMessage: string): void {
    // 检查日期是否变化，如果变化则重新创建文件流
    const today = this.getDateFolderName();
    if (today !== this.currentDate) {
      this.currentDate = today;
      this.createLogStream();
    }

    if (this.fileStream) {
      this.fileStream.write(formattedMessage + "\n");
    }
  }

  /**
   * 通用日志方法
   */
  private log(level: LogLevel, message: string, data?: any): void {
    const formattedMessage = this.formatMessage(level, message, data);

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
    this.writeToFile(formattedMessage);
  }

  /**
   * Debug级别日志
   */
  debug(message: string, data?: any): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  /**
   * Info级别日志
   */
  info(message: string, data?: any): void {
    this.log(LogLevel.INFO, message, data);
  }

  /**
   * Warn级别日志
   */
  warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, message, data);
  }

  /**
   * Error级别日志
   */
  error(message: string, data?: any): void {
    this.log(LogLevel.ERROR, message, data);
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
   * 关闭文件流
   */
  close(): void {
    if (this.fileStream) {
      this.fileStream.end();
      this.fileStream = null;
    }
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
          if (folderName === this.currentDate) {
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

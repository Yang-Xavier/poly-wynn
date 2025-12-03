import { Side } from '@polymarket/clob-client';
import * as fs from 'fs';
import * as path from 'path';
import { PolymarketOrderResult } from './clob';
import { getGlobalConfig } from '@utils/config';

// 定义基础日志类型
export type BaseLogType = 'info' | 'trade' | 'error' | 'debug' | 'data';

// 定义日志类型，支持扩展
// 要添加新的日志类型，只需在联合类型中添加新的字符串字面量
// 例如：export type LogType = BaseLogType | 'api' | 'database' | 'performance';
export type LogType = BaseLogType;

// 日志级别枚举
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

// Logger配置接口
export interface LoggerConfig {
  logDir?: string; // 日志目录，默认为 './logs'
  traceId?: string; // 追踪ID，所有日志都会包含此ID
  logFormat?: (level: LogLevel, type: LogType, message: string, traceId: string | undefined, data?: any) => string; // 日志格式化函数
}

// 默认配置
const DEFAULT_CONFIG: Required<Omit<LoggerConfig, 'traceId'>> & { traceId?: string } = {
  logDir: './logs',
  logFormat: (level: LogLevel, type: LogType, message: string, traceId: string | undefined, data?: any) => {
    // 使用中国北京时区（东八区），display as "YYYY-MM-DD HH:mm:ss.SSS 北京时间"
    // 将时间换算成 UTC+8 时间 (北京时间)
    const date = new Date();
    const utc8Date = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    const timestamp = utc8Date
      .toISOString()
      .replace('T', ' ')
      .replace('Z', ' 北京时间');
    const traceIdStr = traceId ? ` [TraceID: ${traceId}]` : '';
    const dataStr = data ? ` | Data: ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${level}] [${type.toUpperCase()}]${traceIdStr} ${message}${dataStr}`;
  },
};

/**
 * Logger类 - 支持多种日志类型，每种类型输出到不同文件
 */
export class Logger {
  private static instance: Logger | null = null;
  private config: Required<Omit<LoggerConfig, 'traceId'>> & { traceId?: string };
  private fileStreams: Map<LogType, fs.WriteStream> = new Map();
  private traceId: string | undefined;
  private currentDate: string = ''; // 当前日期文件夹名称

  private constructor() {
    const globalConfig = getGlobalConfig();
    this.config = { ...DEFAULT_CONFIG, ...globalConfig.logger};

    // 确保日志目录存在
    if (!fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
    }

    // 初始化当前日期
    this.currentDate = this.getDateFolderName();

    // 为默认日志类型创建文件流
    // 注意：如果扩展了新的日志类型，需要在这里添加，或者使用 addLogType 方法动态添加
    const defaultLogTypes: BaseLogType[] = ['info', 'trade', 'error', 'debug', 'trade'];
    defaultLogTypes.forEach((type) => {
      this.createLogStream(type);
    });
  }

    /**
   * 获取 Clob 单例实例
   * @returns Clob 单例实例
   */
    public static getInstance(): Logger {
      if (!Logger.instance) {
        Logger.instance = new Logger();
      }
      return Logger.instance;
    }

  /**
   * 获取当前日期的文件夹名称（格式：YYYY-MM-DD）
   */
  private getDateFolderName(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 获取日志文件的完整路径（包含日期文件夹）
   */
  private getLogFilePath(type: LogType, dateFolder: string): string {
    const dateDir = path.join(this.config.logDir, dateFolder);
    // 确保日期文件夹存在
    if (!fs.existsSync(dateDir)) {
      fs.mkdirSync(dateDir, { recursive: true });
    }
    return path.join(dateDir, `${type}.log`);
  }

  /**
   * 创建单个日志类型的文件流
   */
  private createLogStream(type: LogType, dateFolder?: string): void {
    const date = dateFolder || this.getDateFolderName();
    const logFilePath = this.getLogFilePath(type, date);
    
    // 如果已存在该类型的文件流，先关闭它
    const existingStream = this.fileStreams.get(type);
    if (existingStream) {
      existingStream.end();
    }
    
    // 以追加模式打开日志文件，防止覆盖已有内容
    const stream = fs.createWriteStream(logFilePath, { flags: 'a' });
    this.fileStreams.set(type, stream);
  }

  /**
   * 写入日志到文件
   */
  private writeToFile(type: LogType, formattedMessage: string): void {
    // 检查日期是否变化，如果变化则重新创建文件流
    const today = this.getDateFolderName();
    if (today !== this.currentDate) {
      this.currentDate = today;
      // 重新创建所有文件流以使用新的日期文件夹
      this.fileStreams.forEach((stream, logType) => {
        this.createLogStream(logType, today);
      });
    }
    
    // 如果该类型的文件流不存在，创建它
    if (!this.fileStreams.has(type)) {
      this.createLogStream(type);
    }
    
    const stream = this.fileStreams.get(type);
    if (stream) {
      stream.write(formattedMessage + '\n');
    }
  }

  /**
   * 通用日志方法
   */
  private log(
    level: LogLevel,
    type: LogType,
    message: string,
    data?: any,
    enableConsole:boolean = true
  ): void {
    const formattedMessage = this.config.logFormat(level, type, message, this.traceId, data);

    // 输出到控制台
    if (enableConsole) {
      if (level === LogLevel.ERROR) {
        console.error(formattedMessage);
      } else {
        console.log(formattedMessage);
      }
    }

    // 写入到对应类型的文件
    this.writeToFile(type, formattedMessage);
  }

  /**
   * Info类型日志
   */
  info(message: string, data?: any): void {
    this.log(LogLevel.INFO, 'info', message, data);
  }

  /**
   * Trade类型日志
   */
  trade(type: 'buy' | 'sell' | 'redeem', orderResult: PolymarketOrderResult): void {
    const {  price, outcome, size_matched, market } = orderResult;
    const totalPriceAmount = Number(size_matched) * Number(price);
    const label = {
      buy: '✅',
      sell: '❌',
      redeem: '✌️'
    }
    if(type === 'redeem') {
      this.log(LogLevel.INFO, 'trade', `[${type}${label[type]}], outcome: ${outcome}, amount: ${size_matched}`);
      return;
    } else {
      this.log(LogLevel.INFO, 'trade', `[${type}${label[type]}], outcome: ${outcome}, totalPriceAmount: ${totalPriceAmount}, avgPrice: ${price}, rawOrderResult: ${JSON.stringify(orderResult)}`);
    }
  }

  /**
   * Error类型日志
   */
  error(message: string, data?: any): void {
    this.log(LogLevel.ERROR, 'error', message, data);
  }

  /**
   * Debug类型日志
   */
  debug(message: string, data?: any): void {
    this.log(LogLevel.DEBUG, 'debug', message, data);
  }

  /**
   * Warn类型日志（输出到info文件）
   */
  warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, 'info', message, data);
  }

  /**
   * 关闭所有文件流
   */
  close(): void {
    this.fileStreams.forEach((stream) => {
      stream.end();
    });
    this.fileStreams.clear();

  }

  /**
   * 扩展新的日志类型（运行时扩展）
   * 注意：此方法允许在运行时添加新的日志类型
   * 要添加新的日志类型，建议：
   * 1. 在 LogType 类型定义中添加新的类型（如 'api' | 'database'）
   * 2. 在需要时调用此方法或直接使用 customLog 方法
   */
  addLogType(type: LogType): void {

    this.createLogStream(type);
  }

  /**
   * 自定义日志方法（用于扩展的日志类型）
   */
  customLog(type: LogType, level: LogLevel, message: string, data?: any, enableConsole?:boolean): void {
    this.addLogType(type); // 确保类型已添加
    this.log(level, type, message, data, enableConsole);
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
}
export const getLoggerModule = () => Logger.getInstance();
// 导出便捷方法
export const logInfo = (message: string, data?: any) => getLoggerModule().info(message, data);
export const logData = (message: string, data?: any) => getLoggerModule().customLog('data', LogLevel.INFO, message, data, false);;
export const logError = (message: string, data?: any) => getLoggerModule().error(message, data);
export const logDebug = (message: string, data?: any) => getLoggerModule().debug(message, data);
export const logWarn = (message: string, data?: any) => getLoggerModule().warn(message, data);
export const logTrade = (type: 'buy' | 'sell' | 'redeem', orderResult: PolymarketOrderResult) => getLoggerModule().trade(type, orderResult);
export const setTraceId = (traceId: string) => getLoggerModule().setTraceId(traceId);

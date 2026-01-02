import { Logger } from "@shared/Logger";

export { LogLevel } from "@shared/Logger";

// 创建 logger 实例
const logger = new Logger({
  appName: "spreadArbitrage",
  enableConsole: true,
});

// 导出 logger 相关函数
export const getLoggerModule = () => logger;
export const logInfo = (message: string, data?: any) => getLoggerModule().info(message, data);
export const logError = (message: string, data?: any) => getLoggerModule().error(message, data);

export const logData = (message: string, data?: any) =>
  getLoggerModule().info(message, data, "data");

export const logChance = (message: string, data?: any) =>
  getLoggerModule().info(message, data, "chance");

export const logStrategy = (message: string, data?: any) =>
  getLoggerModule().info(message, data, "strategy");

export const setTraceId = (traceId: string) => getLoggerModule().setTraceId(traceId);

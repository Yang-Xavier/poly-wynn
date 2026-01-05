import { Logger } from "@shared/Logger";

export { LogLevel } from "@shared/Logger";

const logger = new Logger({
  appName: "crypto15min",
});

export const getLoggerModule = () => logger;
export const logInfo = (message: string, data?: any) => getLoggerModule().info(message, data);
export const logError = (message: string, data?: any) => getLoggerModule().error(message, data);

export const logData = (message: string, data?: any) =>
  getLoggerModule().info(message, data, "data");

export const customTypeLog = (type: string, message: string, data?: any) =>
  getLoggerModule().info(message, data, type);

export const setTraceId = (traceId: string) => getLoggerModule().setTraceId(traceId);

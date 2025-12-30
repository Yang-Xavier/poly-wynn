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

export const logTrade = (
  tradeType: "buy" | "sell" | "redeem" | "lost" | "balance" | "won" | "skip",
  data?: any,
  message?: string
) => {
  const label = {
    buy: "✅",
    sell: "❌",
    redeem: "👍🏻",
    lost: "🈚️",
    balance: "💰",
    won: "🎉",
    skip: "⏭️",
  };

  getLoggerModule().info(`${label[tradeType]} ${tradeType} ${message ?? ""}`, data, "trade");
};

export const setTraceId = (traceId: string) => getLoggerModule().setTraceId(traceId);

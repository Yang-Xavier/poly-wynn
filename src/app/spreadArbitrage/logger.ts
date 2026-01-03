import { Logger } from "@shared/Logger";

export { LogLevel } from "@shared/Logger";

// 创建 logger 实例
const logger = new Logger({
  appName: "spreadArbitrage",
  enableConsole: false,
});

// 导出 logger 相关函数
export const getLoggerModule = () => logger;
export const logInfo = (message: string, data?: any) => getLoggerModule().info(message, data);
export const logError = (message: string, data?: any) => getLoggerModule().error(message, data);

export const logData = (message: string, data?: any) =>
  getLoggerModule().info(message, data, "data");

export const customTypeLog = (type: string, message: string, data?: any) =>
  getLoggerModule().info(message, data, type);

type TradeType = "buy" | "sell" | "balance";

export const logTrade = (
  tradeType: TradeType,
  data: {
    size?: number;
    originalSize?: number;
    price?: number;
    originalPrice?: number;
    profit?: number;
    loss?: number;
    balance?: number;
    holdTime?: number;
  }
) => {
  const label = {
    buy: "✅",
    sell: "💰",
    balance: "🏠",
  };
  let msg = `${label[tradeType]}${tradeType} => `;
  if (tradeType === "buy" || tradeType === "sell") {
    msg += `original: ${data.originalSize}@${data.originalPrice}; matched: ${data.size}@${data.price}; 
    ------------------------------------------------------------
    ${data.profit ? `💡profit: ${data.profit}` : ""} 
    ${data.loss ? `🈚️loss: ${data.loss}` : ""}
    ${data.holdTime ? `holdTime: ${data.holdTime}` : ""}  
    ------------------------------------------------------------
    `;
  } else if (tradeType === "balance") {
    msg += data.balance;
  }
  customTypeLog("trade", msg);
};

export const setTraceId = (traceId: string) => getLoggerModule().setTraceId(traceId);

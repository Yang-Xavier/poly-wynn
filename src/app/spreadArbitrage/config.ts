import { configFactory } from "@shared/configFactory";

const config = {
  marketTag: "btc",

  delayToStart: 3 * 60 * 1000, // 延迟开始时间
  buyingAmountFactor: 2, // 购买金额因子
  maxBuyAmount: 100, // 最大购买金额
  startCalcMinDataPoints: 100, // 开始计算的最小数据量
  stopProfitFactor: 0.5, // 止盈因子
  bsmProbThreshold: 0.17, // 概率阈值

  funderAddress: "0x8dF2E7574F5E97103F037ed45fB323FdBeABEEA8", // 资金地址
};

export const getConfig = () => {
  return config;
};

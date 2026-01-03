import { configFactory } from "@shared/configFactory";

const config = {
  marketTag: "btc",

  delayToStart: 3 * 60 * 1000, // 延迟开始时间
  buyingAmountFactor: 0.2, // 购买金额因子
  maxBuyAmount: 100, // 最大购买金额
  startCalcMinDataPoints: 100, // 开始计算的最小数据量
  stopProfitFactor: 0.5, // 止盈因子
  deltaRateThreshold: 0.5, // 价差阈值
  bsmProbThreshold: 0.1, // 概率阈值
};

export const getConfig = configFactory(config);

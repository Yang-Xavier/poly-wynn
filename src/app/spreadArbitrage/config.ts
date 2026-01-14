import { getEncryptedConfig, TAccountConfig } from "@shared/encryptConfig";

const config = {
  marketTag: "btc",

  delayToStart: 3 * 60 * 1000, // 延迟开始时间
  buyingAmountFactor: 1, // 购买金额因子
  maxBuyAmount: 2, // 最大购买金额

  stopProfitFactor: 0.5, // 止盈因子
  bsmProbThreshold: 0.17, // 概率阈值
  maxBuyCount: 1, // 最大购买次数

  strategy: {
    minDataPoints: 10, // 最小数据量
    alignWindowMs: 50, // 对齐窗口时间
    bsmConfidenceThreshold: 0.7, // 概率置信度阈值
    buyInProbMinGap: 0.17, // 买入概率最小间隙
    stopProfitFactor: 0.5, // 止盈因子
  },

  minBuyAmount: 1, // 最小购买金额
  minSellSize: 1, // 最小卖出数量

  accountId: "account2",
};

export const getConfig = () => {
  const accountConfig = getEncryptedConfig(config.accountId) as TAccountConfig;
  return { ...config, account: accountConfig };
};

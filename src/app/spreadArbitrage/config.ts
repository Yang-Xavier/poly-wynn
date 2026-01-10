import { getEncryptedConfig, TAccountConfig } from "@shared/encryptConfig";

const config = {
  marketTag: "eth",

  delayToStart: 3 * 60 * 1000, // 延迟开始时间
  buyingAmountFactor: 0.1, // 购买金额因子
  maxBuyAmount: 2, // 最大购买金额
  startCalcMinDataPoints: 100, // 开始计算的最小数据量
  stopProfitFactor: 0.5, // 止盈因子
  bsmProbThreshold: 0.17, // 概率阈值
  maxBuyAccount: 5, // 最大购买次数
};

export const getConfig = () => {
  const accountConfig = getEncryptedConfig("account1") as TAccountConfig;
  return { ...config, account: accountConfig };
};

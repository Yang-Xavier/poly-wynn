import { getEncryptedConfig, TAccountConfig } from "@shared/encryptConfig";

const commonConfig = {
  marketTag: "eth",
  clobHost: "https://clob.polymarket.com",
  gammaHost: "https://gamma-api.polymarket.com",
  dataHost: "https://data-api.polymarket.com",
  polymarketHost: "https://polymarket.com",
  ws: {
    liveDataUrl: "wss://ws-live-data.polymarket.com/",
    marketDataUrl: "wss://ws-subscriptions-clob.polymarket.com/ws/market",
    maxCacheSize: 1000,
  },

  collateralAddress: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", // USDC

  redeemConfig: {
    relayerUrl: "https://relayer-v2.polymarket.com/",
    ctf: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045",
    negRiskAdapter: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
    usdc: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    rpcUrl: "https://polygon-rpc.com",
    polymarketRpc: "https://polygon-mainnet.g.alchemy.com/v2/mewmTuTYExTSI0lZisD2szwmi35fZY-r",
    polymarketRpcOrigin: "https://polymarket.com",
    delyRedeem: 180000,
    delyLogBalance: 180000,
  },

  logger: {
    logDir: "./logs",
  },

  stratgegy: {
    startCollectDataBefore: 600000,
    startStrategyBefore: 180000,
    startGetPriceToBeatBefore: 360000,
    updateBalanceInterval: 180000,

    buyingRetryCount: 5,
    buyingMaxSplit: 3,
    buyingMaxAmount: 200,
    buyingAmountFactor: 1,
    buyLimitCountInARoundOf15min: 1,
    buyAcceptableWinProbabilityRange: [0.995, 0.95],
    buyPositionReduceFactorRange: [0.8, 0.5], // 实际购买仓位 1 - buyPositionReduceFactor
    buyBestAskThreshold: 0.9,
    buyMaxVolumeThreshold: 0.5, // 最大订单量阈值
    buyMinimumAmount: 10,

    sellProbabilityThreshold: 0.45,
    sellPredictProbabilityThreshold: 0.35,
    sellMinimumSize: 1,
  },
};

const ethConfig = {
  accountId: "account3",
};

const btcConfig = {
  accountId: "account2",
};

type TGlobalConfig = typeof commonConfig &
  typeof ethConfig &
  typeof btcConfig & { account: TAccountConfig };

/**
 * 获取全局配置对象
 */
export function getGlobalConfig(): TGlobalConfig {
  return getConfig();
}

const deepMerge = (obj1: Record<string, any>, obj2: Record<string, any>) => {
  return Object.keys(obj2).reduce((acc, key) => {
    if (typeof obj2[key] === "object" && obj2[key] !== null) {
      acc[key] = deepMerge(obj1[key], obj2[key]);
    } else {
      acc[key] = obj2[key];
    }
    return acc;
  }, obj1);
};

let computedConfig: TGlobalConfig | null = null;

export const getConfig = () => {
  if (computedConfig) {
    return computedConfig;
  }
  if (process && process.env) {
    if (process.env.MARKET === "eth") {
      const accountConfig = getEncryptedConfig(ethConfig.accountId) as TAccountConfig;
      computedConfig = {
        ...(deepMerge(commonConfig, ethConfig) as TGlobalConfig),
        marketTag: "eth",
        account: accountConfig,
      };
    } else if (process.env.MARKET === "btc") {
      const accountConfig = getEncryptedConfig(btcConfig.accountId) as TAccountConfig;
      computedConfig = {
        ...(deepMerge(commonConfig, btcConfig) as TGlobalConfig),
        marketTag: "btc",
        account: accountConfig,
      };
    }
    return computedConfig;
  }
};

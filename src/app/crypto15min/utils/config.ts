import { getEncryptedConfig } from "@shared/encryptConfig";

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

  account: {
    walletAddress: "0xadc6b5af3b65479a9c4122f32ed324dc2b4265c9",
    funderAddress: "0x8dF2E7574F5E97103F037ed45fB323FdBeABEEA8",
    balanceTokenAddress: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
  },

  redeemConfig: {
    relayerUrl: "https://relayer-v2.polymarket.com/",
    ctf: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045",
    negRiskAdapter: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
    usdc: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    rpcUrl: "https://polygon-rpc.com",
    delyRedeem: 180000,
    delyLogBalance: 180000,
  },

  logger: {
    logDir: "./logs",
  },
};

const ethConfig = {
  stratgegy: {
    startCollectDataBefore: 600000,
    startStrategyBefore: 180000,
    startGetPriceToBeatBefore: 360000,

    buyingRetryCount: 5,
    buyingMaxSplit: 3,
    buyingMaxAmount: 50,
    buyingAmountFactor: 0.2,
    limitBuyCountInARoundOf15min: 1,

    sellProbabilityThreshold: 0.4,

    bestAskThreshold: 0.95,

    tailSweepConfig: {
      minWinProbability: 0.99,
      minEdge: -1,
      maxFlipRisk: 0.1,
      riskAversion: 2,
    },
  },
};

const btcConfig = {
  stratgegy: {
    startCollectDataBefore: 600000,
    startStrategyBefore: 180000,
    startGetPriceToBeatBefore: 360000,

    buyingRetryCount: 5,
    buyingMaxSplit: 3,
    buyingMaxAmount: 50,
    buyingAmountFactor: 0.2,
    limitBuyCountInARoundOf15min: 1,

    sellProbabilityThreshold: 0.4,

    bestAskThreshold: 0.95,

    tailSweepConfig: {
      minWinProbability: 0.99,
      minEdge: -1,
      maxFlipRisk: 0.1,
      riskAversion: 2,
    },
  },
};

/**
 * 获取全局配置对象
 * @returns {typeof import('../config').globalConfig}
 */
export function getGlobalConfig() {
  // 从json文件中读取config
  if (process && process.env && process.env.MARKET) {
    if (process.env.MARKET === "eth") {
      return { ...commonConfig, ...ethConfig };
    } else if (process.env.MARKET === "btc") {
      return { ...commonConfig, ...btcConfig };
    }
  }
  return commonConfig;
}

export function getKeyConfig() {
  // 从json文件中读取config
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const config = getEncryptedConfig();
  return config;
}

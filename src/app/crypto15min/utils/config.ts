import { getEncryptedConfig, TAccountConfig } from "@shared/encryptConfig";

const commonConfig = {
  marketTag: "",
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
};

const ethConfig = {
  accountId: "account3",
  stratgegy: {
    startCollectDataBefore: 600000,
    startStrategyBefore: 180000,
    startGetPriceToBeatBefore: 360000,

    buyingRetryCount: 5,
    buyingMaxSplit: 3,
    buyingMaxAmount: 100,
    buyingAmountFactor: 0.2,
    buyLimitCountInARoundOf15min: 1,
    buyAcceptableWinProbabilityRange: [0.995, 0.9],
    buyBestAskThreshold: 0.9,
    buyMaxVolumeThreshold: 0.5, // 最大订单量阈值
    buyMinimumAmount: 1,

    sellProbabilityThreshold: 0.45,
    sellPredictProbabilityThreshold: 0.35,
    sellMinimumSize: 1,
  },
};

const btcConfig = {
  accountId: "account2",
  stratgegy: {
    startCollectDataBefore: 600000,
    startStrategyBefore: 180000,
    startGetPriceToBeatBefore: 360000,

    buyingRetryCount: 5,
    buyingMaxSplit: 3,
    buyingMaxAmount: 100,
    buyingAmountFactor: 0.5,
    buyLimitCountInARoundOf15min: 1,
    buyAcceptableWinProbabilityRange: [0.995, 0.95],
    buyBestAskThreshold: 0.9,
    buyMaxVolumeThreshold: 0.5, // 最大订单量阈值
    buyMinimumAmount: 1,

    sellProbabilityThreshold: 0.4,
    sellPredictProbabilityThreshold: 0.35,
    sellMinimumSize: 1,
  },
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

export const getConfig = () => {
  if (process && process.env && process.env.MARKET) {
    if (process.env.MARKET === "eth") {
      const accountConfig = getEncryptedConfig(ethConfig.accountId) as TAccountConfig;
      return { ...commonConfig, ...ethConfig, marketTag: "eth", account: accountConfig };
    } else if (process.env.MARKET === "btc") {
      const accountConfig = getEncryptedConfig(btcConfig.accountId) as TAccountConfig;
      return { ...commonConfig, ...btcConfig, marketTag: "btc", account: accountConfig };
    }
  }
};

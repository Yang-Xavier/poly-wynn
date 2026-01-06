export const CLOB_HOST = "https://clob.polymarket.com";
export const GAMMA_HOST = "https://gamma-api.polymarket.com";
export const DATA_HOST = "https://data-api.polymarket.com";
export const POLYMARKET_HOST = "https://polymarket.com";

export const WS_LIVE_DATA_URL = "wss://ws-live-data.polymarket.com";
export const WS_POLY_ORDER_BOOK_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
export const WS_BN_PRICE_URL = "wss://stream.binance.com:9443/ws";
export const WS_USER_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/user";

// web3
export const POLY_RELAYER_URL = "https://relayer-v2.polymarket.com/";
export const CTF = "0x4d97dcd97ec945f40cf65f87097ace5ea0476045";
export const NEG_RISK_ADAPTER = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296";
export const USDC_ADDRESS = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";
export const RPC_URL = "https://polygon-rpc.com";

// account
export const WALLET_ADDRESS = "0xadc6b5af3b65479a9c4122f32ed324dc2b4265c9";
export const FUNDER_ADDRESS = "0x8dF2E7574F5E97103F037ed45fB323FdBeABEEA8";

export enum OUTCOMES_ENUM {
  Up = "Up",
  Down = "Down",
}

export enum WATCH_POSITION_ACTION_ENUM {
  sellInProfit = "sellInProfit",
  sellInLoss = "sellInLoss",
  hold = "hold",
  sell = "sell",
}

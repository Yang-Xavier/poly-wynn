import Trader, { TraderConfig } from "@shared/trade/Trader";

let trader: Trader;

export const initTrader = (config: TraderConfig) => {
  trader = new Trader(config);
};

export const getTrader = () => {
  return trader;
};

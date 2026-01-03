import { configFactory } from "@shared/configFactory";

const config = {
  marketTag: "eth",

  buyingAmountFactor: 0.2,
  maxBuyAmount: 100,

  startCalcMinDataPoints: 200,

  predictProbFactor: 0.5,

  deltaRateThreshold: 0.5,
  bsmProbThreshold: 0.12,
};

export const getConfig = configFactory(config);

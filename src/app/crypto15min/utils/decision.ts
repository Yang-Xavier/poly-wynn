import { calculateProbabilityBasedOnGBM } from "@shared/algorithm/gbm";
import { calculateProbabilityBasedOnBSM } from "@shared/algorithm/bsm";
import { OUTCOMES_ENUM } from "@shared/constants";
import { PriceData } from "@shared/ws/PolyPriceWs";

export const decision = (historyPriceList: PriceData[], priceToBeat: number, distance: number) => {
  const probabilityBasedOnGBM = calculateProbabilityBasedOnGBM(
    historyPriceList,
    priceToBeat,
    distance
  );
  const probabilityBasedOnBSM = calculateProbabilityBasedOnBSM(
    historyPriceList,
    priceToBeat,
    distance
  );
  const probUp = Math.min(probabilityBasedOnGBM.upProb, probabilityBasedOnBSM.probUp);
  const probDown = Math.min(probabilityBasedOnGBM.downProb, probabilityBasedOnBSM.probDown);

  const side = probUp > 0.5 ? OUTCOMES_ENUM.Up : OUTCOMES_ENUM.Down;

  return {
    side,
    winProbability: side === OUTCOMES_ENUM.Up ? probUp : probDown,
    confidence: Math.min(probabilityBasedOnGBM.confidence, probabilityBasedOnBSM.confidence),
    probabilityBasedOnGBM,
    probabilityBasedOnBSM,
  };
};

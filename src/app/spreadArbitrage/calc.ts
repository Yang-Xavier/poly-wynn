import { OUTCOMES_ENUM } from "@shared/constants";

/**
 * 计算科学的止损点
 * 基于BSM模型的置信度、概率优势和剩余时间
 *
 * 止损逻辑：
 * 1. 基础止损幅度基于概率优势：优势越大，可容忍的价格反向波动越大
 * 2. 置信度调整：置信度越低，止损越紧（更接近买入价）
 * 3. 时间调整：剩余时间越短，止损可以更宽松（接近到期时，中途波动对最终结果影响小）
 *    在二元期权中，只要最终方向正确，无论中途如何波动，最终都会被resolve为1
 *    因此时间越长，不确定性越大，止损应该更紧，避免被中途波动错误触发
 * 4. 风险回报比：止损幅度不应超过预期收益的合理比例
 */
export function calculateStopLoss(params: {
  buyPrice: number;
  bsmProbability: number;
  confidence: number;
  probAdvantage: number; // BSM概率与市场价格的差值
  timeToExpiryMs: number;
  outcome: OUTCOMES_ENUM;
}): number {
  const { buyPrice, bsmProbability, confidence, probAdvantage, timeToExpiryMs } = params;

  // 1. 基础止损幅度（基于概率优势）
  // 优势越大，可以容忍更大的价格反向波动
  // 但也要设置合理的上下限（2%到20%之间）
  const absAdvantage = Math.abs(probAdvantage);
  const baseStopLossRatio = Math.max(0.02, Math.min(0.2, absAdvantage * 1.2));

  // 2. 置信度调整：置信度越低，止损应该更紧
  // confidence低时，止损幅度减小（止损价格更接近买入价）
  // 映射到0.4-1.0之间：置信度0时止损幅度为40%，置信度1时止损幅度为100%
  const confidenceFactor = 0.4 + confidence * 0.6;

  // 3. 时间调整：剩余时间越短，止损可以更宽松
  // 在二元期权中，只要最终方向正确，无论中途如何波动，最终都会被resolve为1
  // 因此时间越短（接近到期），中途价格波动对最终结果的影响越小，止损可以更宽松
  // 时间越长，不确定性越大，止损应该更紧，避免被中途波动错误触发
  const timeToExpirySeconds = timeToExpiryMs / 1000;
  let timeFactor = 1.0;
  if (timeToExpirySeconds < 5) {
    timeFactor = 1.5; // 时间极短时，止损可以非常宽松（接近到期，波动影响小）
  } else if (timeToExpirySeconds < 30) {
    timeFactor = 1.3; // 时间很短，止损较宽松
  } else if (timeToExpirySeconds < 120) {
    timeFactor = 1.1; // 时间较短，止损稍微宽松
  } else if (timeToExpirySeconds > 600) {
    timeFactor = 0.7; // 时间较长时，止损更紧（避免被中途波动错误触发）
  } else if (timeToExpirySeconds > 300) {
    timeFactor = 0.85; // 时间中等偏长，止损稍微紧一些
  }

  // 4. 综合止损幅度
  const stopLossRatio = baseStopLossRatio * confidenceFactor * timeFactor;

  // 5. 计算止损价格（止损价格低于买入价）
  // 在二元期权中，价格就是概率。如果市场价格下跌，说明市场不看好该方向，需要止损
  let stopLossPrice = Math.max(0, buyPrice - stopLossRatio);

  // 6. 确保止损价格在合理范围内
  // 止损价格不应该低于BSM预测概率的某个比例（比如60%），因为如果BSM预测本身就很低，那应该更谨慎
  const minStopLossPrice = Math.max(0, bsmProbability * 0.6);
  stopLossPrice = Math.max(stopLossPrice, minStopLossPrice);

  // 7. 确保止损价格不会高于买入价格的某个比例（比如95%），否则止损太宽松
  // 但也要考虑到如果买入价格本身就很低的情况
  const maxStopLossPrice = buyPrice * 0.95;
  if (stopLossPrice > maxStopLossPrice && buyPrice > 0.1) {
    stopLossPrice = maxStopLossPrice;
  }

  return Number(Math.max(0, Math.min(1, stopLossPrice)).toFixed(2));
}

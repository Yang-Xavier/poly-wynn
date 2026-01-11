/**
 * 单个价格点（带时间戳），用于构建尾盘决策使用的历史序列
 */
export interface TailPriceTick {
  value: number;
  timestamp: number;
}

/**
 * 尾盘扫盘算法输入
 * - ticks: 当前局内（或更长一段时间）的 ETH 历史价格序列
 * - intervalStartPrice: 本 15 分钟局开始时的 ETH 价格（决定最终输赢的基准价）
 * - timeToExpiryMs: 距离本局结束剩余毫秒数
 */
export interface TailSweepInput {
  historyPriceList: TailPriceTick[];
  priceToBeat: number;
  distance: number;
}

// ------------------------- 数学 & 辅助函数 -------------------------

// 误差函数 erf 的近似实现（Abramowitz and Stegun 7.1.26）
const erf = (x: number): number => {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);

  return sign * y;
};

// 标准正态分布的 CDF
const normalCdf = (x: number): number => {
  return 0.5 * (1 + erf(x / Math.SQRT2));
};

// timestamp -> 毫秒时间戳
const toMs = (ts: number | string): number => {
  if (typeof ts === "number") return ts;
  const t = new Date(ts).getTime();
  return isNaN(t) ? 0 : t;
};

interface GBMStats {
  mu: number; // 单步对数收益均值
  sigma: number; // 单步对数收益标准差
  stepsAhead: number; // 未来等效时间步数
}

/**
 * 使用简化 GBM 模型，根据历史 ticks 估计：
 * - 单步对数收益均值 mu
 * - 单步对数收益波动率 sigma
 * - 未来等效时间步数 stepsAhead
 *
 * 思路：
 * - 对数收益 r_i = ln(P_i / P_{i-1})
 * - 未来剩余时间 / 历史覆盖时间 ≈ 未来步数 / 历史步数
 */
const estimateGBMStats = (ticks: TailPriceTick[], timeToExpiryMs: number): GBMStats | null => {
  const n = ticks.length;
  if (n < 2 || timeToExpiryMs <= 0) return null;

  const sorted = [...ticks].sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
  const firstTs = toMs(sorted[0].timestamp);
  const lastTs = toMs(sorted[sorted.length - 1].timestamp);
  const historyDurationMs = lastTs - firstTs;

  const prices = sorted.map((p) => p.value).filter((p) => p > 0);
  if (prices.length < 2 || historyDurationMs <= 0) return null;

  const logReturns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const curr = prices[i];
    if (prev > 0 && curr > 0) {
      logReturns.push(Math.log(curr / prev));
    }
  }

  const m = logReturns.length;
  if (m === 0) return null;

  const mu = logReturns.reduce((sum, r) => sum + r, 0) / m;

  let variance = 0;
  for (const r of logReturns) {
    const diff = r - mu;
    variance += diff * diff;
  }
  variance /= Math.max(1, m - 1);
  const sigma = Math.sqrt(variance);

  const stepsAhead = (m * timeToExpiryMs) / historyDurationMs;
  if (!isFinite(stepsAhead) || stepsAhead <= 0) return null;

  return { mu, sigma, stepsAhead };
};

/**
 * 计算置信度的辅助函数
 * 置信度基于：
 * 1. 样本数量（更多样本 -> 更高置信度）
 * 2. 波动率（sigma，更低波动率 -> 更高置信度）
 * 3. 外推距离（stepsAhead / 历史步数，外推越远 -> 更低置信度）
 * 4. 历史时间跨度（更长的时间跨度 -> 更高置信度）
 */
const calcConfidence = (
  sampleCount: number,
  sigma: number,
  stepsAhead: number,
  historySteps: number,
  historyDurationMs: number,
  timeToExpiryMs: number
): number => {
  // 样本数量因子：更多样本 -> 更高置信度（对数缩放，避免过大）
  // 例如：10个样本 -> 0.7, 50个样本 -> 0.9, 100+个样本 -> 0.95+
  const sampleFactor = Math.min(1, 0.5 + (0.5 * Math.log10(Math.max(1, sampleCount))) / 2);

  // 波动率因子：波动率越低 -> 置信度越高
  // 假设正常波动率约为 0.001-0.01（对数收益的标准差）
  // 波动率越大，置信度越低（使用倒数关系，但限制范围）
  const volatilityFactor = Math.min(1, 1 / (1 + sigma * 100));

  // 外推距离因子：外推越远（相对历史步数）-> 置信度越低
  // 如果外推步数 <= 历史步数，置信度较高；如果外推步数 >> 历史步数，置信度较低
  const extrapolationRatio = stepsAhead / Math.max(1, historySteps);
  const extrapolationFactor = Math.min(1, 1 / (1 + extrapolationRatio * 0.5));

  // 时间跨度因子：历史数据的时间跨度越长（相对预测时间）-> 置信度越高
  const timeSpanRatio = historyDurationMs / Math.max(1, timeToExpiryMs);
  const timeSpanFactor = Math.min(1, 0.7 + 0.3 * Math.min(1, timeSpanRatio / 3));

  // 综合置信度：各因子的加权平均
  // 可以调整权重以强调不同因素的重要性
  const confidence =
    sampleFactor * 0.3 +
    volatilityFactor * 0.3 +
    extrapolationFactor * 0.25 +
    timeSpanFactor * 0.15;

  return Math.max(0, Math.min(1, confidence));
};

/**
 * 在 GBM 假设下，估计到期时价格「高于 intervalStartPrice」的概率和置信度：
 * P(S_T >= K) = P(ln S_T >= ln K)
 * ln S_T ~ N( ln S_0 + mu * stepsAhead, sigma^2 * stepsAhead )
 */
export const calculateProbabilityBasedOnGBM = (
  ticks: TailPriceTick[],
  intervalStartPrice: number,
  timeToExpiryMs: number
): { upProb: number; downProb: number; confidence: number } => {
  const n = ticks.length;
  if (n < 2 || intervalStartPrice <= 0 || timeToExpiryMs <= 0) {
    return { upProb: 0.5, downProb: 0.5, confidence: 0 };
  }

  const gbm = estimateGBMStats(ticks, timeToExpiryMs);
  if (!gbm) return { upProb: 0.5, downProb: 0.5, confidence: 0 };

  const sorted = [...ticks].sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
  const firstTs = toMs(sorted[0].timestamp);
  const lastTs = toMs(sorted[sorted.length - 1].timestamp);
  const historyDurationMs = lastTs - firstTs;

  const lastPrice = sorted.at(-1)!.value;
  if (!isFinite(lastPrice) || lastPrice <= 0) return { upProb: 0.5, downProb: 0.5, confidence: 0 };

  const { mu, sigma, stepsAhead } = gbm;

  // 计算历史步数（用于置信度计算）
  const prices = sorted.map((p) => p.value).filter((p) => p > 0);
  const historySteps = Math.max(1, prices.length - 1);
  const sampleCount = historySteps;

  // 计算置信度
  const confidence = calcConfidence(
    sampleCount,
    sigma,
    stepsAhead,
    historySteps,
    historyDurationMs,
    timeToExpiryMs
  );

  const meanLogST = Math.log(lastPrice) + mu * stepsAhead;
  const varLogST = sigma * sigma * stepsAhead;
  const stdLogST = Math.sqrt(varLogST);

  if (!isFinite(stdLogST) || stdLogST === 0) {
    const upProb = lastPrice >= intervalStartPrice ? 1 : 0;
    return { upProb, downProb: 1 - upProb, confidence: confidence * 0.5 }; // 波动率为0时降低置信度
  }

  const logK = Math.log(intervalStartPrice);
  const z = (logK - meanLogST) / stdLogST;
  const downProb = normalCdf(z); // P(S_T <= K)
  const upProb = 1 - downProb; // P(S_T >= K)

  // 数值稳健性处理
  if (!isFinite(upProb)) {
    return { upProb: 0.5, downProb: 0.5, confidence: 0 };
  }

  return { upProb, downProb, confidence };
};

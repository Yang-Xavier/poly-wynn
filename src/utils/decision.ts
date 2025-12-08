import { OUTCOMES_ENUM } from "./constans";

/**
 * 单个价格点（带时间戳），用于构建尾盘决策使用的历史序列
 */
export interface TailPriceTick {
  value: number;
  timestamp: number | string;
}

/**
 * 尾盘扫盘算法输入
 * - ticks: 当前局内（或更长一段时间）的 ETH 历史价格序列
 * - intervalStartPrice: 本 15 分钟局开始时的 ETH 价格（决定最终输赢的基准价）
 * - timeToExpiryMs: 距离本局结束剩余毫秒数
 * - upBestAsk/downBestAsk: Up/Down 两个方向当前盘口的最优卖价（你买入需要付出的价格）
 */
export interface TailSweepInput {
  ticks: TailPriceTick[];
  intervalStartPrice: number;
  timeToExpiryMs: number;
  upBestAsk?: number | null;
  downBestAsk?: number | null;
}

/**
 * 尾盘扫盘模型的一些可调参数
 * - minWinProbability: 建议下注的最小胜率
 * - minEdge: 模型胜率相对盘口隐含胜率需要至少高出多少（绝对值）
 * - maxFlipRisk: 允许的最大“被翻盘概率”（即押的方向到期失败的概率上限）
 * - riskAversion: 对翻盘风险的厌恶系数，越大越保守
 */
export interface TailSweepConfig {
  minWinProbability: number;
  minEdge: number;
  maxFlipRisk: number;
  riskAversion: number;
}

export interface TailSweepDecision {
  shouldBet: boolean;
  side: OUTCOMES_ENUM | null;
  winProbability: number;      // 该方向到期获胜的模型概率
  impliedProbability: number;  // 盘口隐含胜率（由盘口价格反推）
  edge: number;                // 胜率优势：winProbability - impliedProbability
  flipRisk: number;            // 被翻盘概率：1 - winProbability
  score: number;               // 综合打分（包含 riskAversion 等因子）
  reason: string;              // 文字标签便于上层记录/调参
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
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
      Math.exp(-ax * ax);

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
  mu: number;        // 单步对数收益均值
  sigma: number;     // 单步对数收益标准差
  stepsAhead: number;// 未来等效时间步数
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
const estimateGBMStats = (
  ticks: TailPriceTick[],
  timeToExpiryMs: number
): GBMStats | null => {
  const n = ticks.length;
  if (n < 2 || timeToExpiryMs <= 0) return null;

  const sorted = [...ticks].sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
  const firstTs = toMs(sorted[0].timestamp);
  const lastTs = toMs(sorted[sorted.length - 1].timestamp);
  const historyDurationMs = lastTs - firstTs;

  const prices = sorted.map(p => p.value).filter(p => p > 0);
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

  const mu =
    logReturns.reduce((sum, r) => sum + r, 0) / m;

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
 * 在 GBM 假设下，估计到期时价格「高于 intervalStartPrice」的概率：
 * P(S_T >= K) = P(ln S_T >= ln K)
 * ln S_T ~ N( ln S_0 + mu * stepsAhead, sigma^2 * stepsAhead )
 */
const calcUpProbability = (
  ticks: TailPriceTick[],
  intervalStartPrice: number,
  timeToExpiryMs: number
): number => {
  const n = ticks.length;
  if (n < 2 || intervalStartPrice <= 0 || timeToExpiryMs <= 0) {
    return 0.5;
  }

  const gbm = estimateGBMStats(ticks, timeToExpiryMs);
  if (!gbm) return 0.5;

  const lastPrice = ticks
    .slice()
    .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp))
    .at(-1)!.value;
  if (!isFinite(lastPrice) || lastPrice <= 0) return 0.5;

  const { mu, sigma, stepsAhead } = gbm;

  const meanLogST = Math.log(lastPrice) + mu * stepsAhead;
  const varLogST = sigma * sigma * stepsAhead;
  const stdLogST = Math.sqrt(varLogST);

  if (!isFinite(stdLogST) || stdLogST === 0) {
    return lastPrice >= intervalStartPrice ? 1 : 0;
  }

  const logK = Math.log(intervalStartPrice);
  const z = (logK - meanLogST) / stdLogST;
  const downProb = normalCdf(z); // P(S_T <= K)
  const upProb = 1 - downProb;   // P(S_T >= K)

  // 数值稳健性处理
  if (!isFinite(upProb)) return 0.5;
  return Math.max(0, Math.min(1, upProb));
};

// ------------------------- 尾盘扫盘核心决策 -------------------------

/**
 * 核心思路：
 * 1. 用简化 GBM 从历史 ticks 估计到期时「高于 intervalStartPrice」的概率 P_up
 * 2. 下跌方向概率 P_down = 1 - P_up
 * 3. 从盘口最优卖价估算隐含概率：
 *    - 价格 p ≈ 成功时赔付 1，盈亏平衡胜率 ≈ p
 * 4. 对每个方向计算：
 *    - edge = P_model - p_implied
 *    - flipRisk = 1 - P_model（押该方向失败的概率）
 *    - score = edge - riskAversion * flipRisk
 * 5. 只有在：
 *    - 胜率 >= minWinProbability
 *    - edge >= minEdge
 *    - flipRisk <= maxFlipRisk
 *    时，才考虑扫盘；从满足条件的方向中选 score 最大的一个。
 */
export const decideTailSweep = (
  input: TailSweepInput,
  cfg?: Partial<TailSweepConfig>
): TailSweepDecision => {
  const {
    ticks,
    intervalStartPrice,
    timeToExpiryMs,
    upBestAsk,
    downBestAsk,
  } = input;

  // 默认参赛参数（偏保守）
  const config: TailSweepConfig = {
    minWinProbability: cfg?.minWinProbability ?? 0.75,
    minEdge: cfg?.minEdge ?? 0.05,
    maxFlipRisk: cfg?.maxFlipRisk ?? 0.20,
    riskAversion: cfg?.riskAversion ?? 0.5,
  };

  // 基本兜底：数据不足时不建议下注
  if (!ticks || ticks.length < 2 || intervalStartPrice <= 0 || timeToExpiryMs <= 0) {
    return {
      shouldBet: false,
      side: null,
      winProbability: 0.5,
      impliedProbability: 0.5,
      edge: 0,
      flipRisk: 0.5,
      score: 0,
      reason: "insufficient_data",
    };
  }

  // 1. 先根据历史价格估算终值概率
  const upProb = calcUpProbability(ticks, intervalStartPrice, timeToExpiryMs);
  const downProb = 1 - upProb;

  // 2. 使用传入的盘口最优卖价（暗含赔率）
  const upAsk = typeof upBestAsk === "number" ? upBestAsk : null;
  const downAsk = typeof downBestAsk === "number" ? downBestAsk : null;

  const candidates: TailSweepDecision[] = [];

  // 方向：Up
  if (upAsk !== null) {
    const implied = upAsk;          // 价格 0~1，视作隐含胜率
    const edge = upProb - implied;
    const flipRisk = 1 - upProb;    // 押 Up 被翻盘的概率
    const score = edge - config.riskAversion * flipRisk;

    const passes =
      upProb >= config.minWinProbability &&
      edge >= config.minEdge &&
      flipRisk <= config.maxFlipRisk;

    candidates.push({
      shouldBet: passes,
      side: OUTCOMES_ENUM.Up,
      winProbability: upProb,
      impliedProbability: implied,
      edge,
      flipRisk,
      score,
      reason: passes
        ? "up_candidate_pass"
        : "up_candidate_fail_threshold",
    });
  }

  // 方向：Down
  if (downAsk !== null) {
    const implied = downAsk;
    const edge = downProb - implied;
    const flipRisk = 1 - downProb;  // 押 Down 被翻盘的概率
    const score = edge - config.riskAversion * flipRisk;

    const passes =
      downProb >= config.minWinProbability &&
      edge >= config.minEdge &&
      flipRisk <= config.maxFlipRisk;

    candidates.push({
      shouldBet: passes,
      side: OUTCOMES_ENUM.Down,
      winProbability: downProb,
      impliedProbability: implied,
      edge,
      flipRisk,
      score,
      reason: passes
        ? "down_candidate_pass"
        : "down_candidate_fail_threshold",
    });
  }

  // 如果连盘口价格都不可用，直接不下注
  if (candidates.length === 0) {
    return {
      shouldBet: false,
      side: null,
      winProbability: upProb,
      impliedProbability: 0.5,
      edge: 0,
      flipRisk: 1 - upProb,
      score: 0,
      reason: "no_orderbook_price",
    };
  }

  // 从所有候选中找出 score 最高的那个
  const best = candidates.reduce((acc, cur) =>
    cur.score > acc.score ? cur : acc
  );

  // 若最好方向本身就没通过阈值，则整体不建议下注
  if (!best.shouldBet) {
    return {
      ...best,
      shouldBet: false,
      side: null,
      reason: "no_direction_meets_threshold",
    };
  }

  return {
    ...best,
    shouldBet: true,
  };
};



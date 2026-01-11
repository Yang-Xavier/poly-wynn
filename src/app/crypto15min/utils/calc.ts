import { getGlobalConfig } from "./config";
import { OUTCOMES_ENUM } from "./constans";
import { TOKEN_ACTION_ENUM } from "./tools";

/**
 * 价格突破某个价格的概率结果
 * - upBreakProbability: 收盘价高于/等于 breakPrice 的概率
 * - downBreakProbability: 收盘价低于/等于 breakPrice 的概率
 */
export interface BreakoutProbabilityResult {
  upBreakProbability: number; // 0 ~ 1
  downBreakProbability: number; // 0 ~ 1
  /**
   * 估计得到的单步对数收益均值（历史样本）
   */
  meanLogReturnPerStep: number;
  /**
   * 估计得到的单步对数收益波动率（标准差，历史样本）
   */
  volatilityPerStep: number;
  /**
   * 以“一个价格点为一个时间步”估算，未来大概还有多少个时间步
   */
  stepsAhead: number;
}

/**
 * 带时间戳的价格点，用于 tick 级别的数据
 * - timestamp 可以是毫秒时间戳数字，或者可以被 new Date() 解析的字符串
 */
export interface PriceTickPoint {
  value: number;
  timestamp: number | string;
}

// 误差函数 erf 的近似实现（Abramowitz and Stegun 7.1.26）
const erf = (x: number): number => {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);

  // 常用近似参数
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

/**
 * 辅助：将 timestamp（number | string）转换为毫秒时间戳
 */
const toMs = (ts: number | string): number => {
  if (typeof ts === "number") return ts;
  const t = new Date(ts).getTime();
  return isNaN(t) ? 0 : t;
};

type TrendDirection = OUTCOMES_ENUM.Up | OUTCOMES_ENUM.Down;

export interface TrendResult {
  direction: TrendDirection;
  upProbability: number; // 0 ~ 1
  downProbability: number; // 0 ~ 1
  confidence: number; // 趋势强度 0 ~ 1
}

/**
 * 根据一段时间内的价格数组，估计向上 / 向下趋势及其“概率”（置信度）
 * @param prices 价格数组，按时间顺序排列
 */
export function calcTrend(prices: { value: number; timestamp: number }[]): TrendResult {
  const n = prices.length;
  if (n < 2) {
    return {
      direction: OUTCOMES_ENUM.Up,
      upProbability: 0.5,
      downProbability: 0.5,
      confidence: 0,
    };
  }

  const first = prices[0].value;
  const last = prices[n - 1].value;

  // 1. 整体涨跌幅
  const totalReturn = (Number(last) - Number(first)) / Number(first); // 比如 0.05 代表 +5%

  // 2. 统计每一步是涨还是跌
  let upCount = 0;
  let downCount = 0;
  for (let i = 1; i < n; i++) {
    const prev = prices[i - 1].value;
    const curr = prices[i].value;
    if (curr > prev) upCount++;
    else if (curr < prev) downCount++;
  }
  const steps = n - 1;
  const stepScore = steps > 0 ? (upCount - downCount) / steps : 0; // [-1, 1]

  // 3. 合成一个方向性得分（可按需要调权重）
  //   - totalReturn 反映首尾涨跌幅
  //   - stepScore 反映中间“多数时间”是涨还是跌
  const combinedRaw = 0.6 * totalReturn + 0.4 * stepScore;

  // 限制到 [-1, 1]，避免极端值
  const combined = Math.max(-1, Math.min(1, combinedRaw));

  // 4. 映射到概率
  const upProbability = (combined + 1) / 2; // combined=-1 -> 0, combined=1 -> 1
  const downProbability = 1 - upProbability;
  const confidence = Math.abs(combined); // 趋势强度

  // 5. 给一个方向标签
  const threshold = 0.2; // 趋势强度阈值，可调
  let direction: TrendDirection = OUTCOMES_ENUM.Up;
  if (confidence >= threshold) {
    direction = combined > 0 ? OUTCOMES_ENUM.Up : OUTCOMES_ENUM.Down;
  }

  return {
    direction,
    upProbability,
    downProbability,
    confidence,
  };
}

/**
 * 计算衰减因子：随着 y 坐标的减小，x 坐标要减小得越来越快
 * - 使用「线性 + 幂函数」混合，让开头有一定斜率、越到结尾越陡
 * @param range - 二维数组，range[0] 是 x 轴范围 [x1, x2]，range[1] 是 y 轴范围 [y1, y2]（不要求前小后大）
 * @param y - 输入的 y 坐标值
 * @param power - 幂指数，默认 3；数值越大，越靠近 y 最小值时 x 衰减越快
 * @param mix - 线性与幂函数的混合比例，默认 0.3；越大，前半段越接近线性、下降不至于太慢
 * @returns 计算出的 x 坐标值
 */
export const calcAttenuationFactor = (
  range: number[][],
  y: number,
  power: number = 2,
  mix: number = 0.8
) => {
  const [xRange, yRange] = range;
  const [x1, x2] = xRange;
  const [y1, y2] = yRange;

  // 允许传入 [max, min] 或 [min, max]，这里统一转成 [min, max]
  const xMin = Math.min(x1, x2);
  const xMax = Math.max(x1, x2);
  const yMin = Math.min(y1, y2);
  const yMax = Math.max(y1, y2);

  if (yMax === yMin) {
    return xMin;
  }

  // 将 y 归一化到 [0, 1]，y = yMin -> 0，y = yMax -> 1
  let yNormalized = (y - yMin) / (yMax - yMin);
  // 防止越界
  yNormalized = Math.max(0, Math.min(1, yNormalized));

  // 设计成：y 从大到小（1 -> 0），x 从大到小且越到后面减得越快
  // 使用线性与幂函数的混合：
  //   baseLinear = yNormalized                    （整体平滑）
  //   basePower  = 1 - (1 - yNormalized)^power   （结尾更陡）
  //   xNormalized = mix * baseLinear + (1 - mix) * basePower
  // 这样：
  // - 保证开头不会太平（有线性部分支撑斜率）
  // - 越靠近 yMin，幂函数贡献越大，下降更快
  const baseLinear = yNormalized;
  const basePower = 1 - Math.pow(1 - yNormalized, power);
  const xNormalized = mix * baseLinear + (1 - mix) * basePower;

  // 将归一化的 x 映射回实际范围
  const x = xMin + (xMax - xMin) * xNormalized;

  return x;
};

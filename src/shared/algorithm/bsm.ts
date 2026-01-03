/**
 * BSM (Black-Scholes-Merton) 模型实现
 * 用于计算二元期权的Up/Down概率
 */

/**
 * 历史价格数据接口
 */
export interface PriceTick {
  value: number;
  timestamp: number;
}

/**
 * BSM模型计算结果
 */
export interface BSMResult {
  probUp: number; // Up方向概率 (P(S_T >= K))
  probDown: number; // Down方向概率 (P(S_T < K))
  confidence: number; // 模型置信度 (0-1)
}

/**
 * BSM模型计算参数
 */
interface BSMParams {
  currentPrice: number; // 当前价格 S0
  strikePrice: number; // 对赌价格/执行价格 K
  timeToExpiry: number; // 剩余时间（年化）
  volatility: number; // 波动率 σ（年化）
  riskFreeRate?: number; // 无风险利率 r（年化），默认0
}

// ------------------------- 数学函数 -------------------------

/**
 * 误差函数 erf 的近似实现（Abramowitz and Stegun 7.1.26）
 */
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

/**
 * 标准正态分布的累积分布函数 (CDF)
 */
const normalCdf = (x: number): number => {
  return 0.5 * (1 + erf(x / Math.SQRT2));
};

// ------------------------- 波动率计算 -------------------------

/**
 * 从历史价格数据计算年化波动率
 * @param priceHistory 历史价格列表（按时间排序）
 * @param lookbackSeconds 回看时间窗口（秒），如果为0则使用全部数据
 * @returns 年化波动率
 */
function calculateVolatility(priceHistory: PriceTick[], lookbackSeconds: number = 0): number {
  if (priceHistory.length < 2) {
    return 0.3; // 默认波动率30%（年化）
  }

  // 按时间戳排序
  const sorted = [...priceHistory].sort((a, b) => a.timestamp - b.timestamp);

  // 如果指定了回看时间，只使用最近的数据
  let prices = sorted.map((p) => p.value).filter((p) => p > 0);
  if (lookbackSeconds > 0 && sorted.length > 1) {
    const cutoffTime = sorted[sorted.length - 1].timestamp - lookbackSeconds * 1000;
    prices = sorted
      .filter((p) => p.timestamp >= cutoffTime)
      .map((p) => p.value)
      .filter((p) => p > 0);
  }

  if (prices.length < 2) {
    return 0.3;
  }

  // 计算对数收益率
  const logReturns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const curr = prices[i];
    if (prev > 0 && curr > 0) {
      logReturns.push(Math.log(curr / prev));
    }
  }

  if (logReturns.length === 0) {
    return 0.3;
  }

  // 计算收益率的标准差
  const mean = logReturns.reduce((sum, r) => sum + r, 0) / logReturns.length;
  let variance = 0;
  for (const r of logReturns) {
    const diff = r - mean;
    variance += diff * diff;
  }
  variance /= Math.max(1, logReturns.length - 1);
  const stdDev = Math.sqrt(variance);

  // 年化波动率
  // 假设数据点的平均时间间隔（秒）
  const firstTs = sorted[0].timestamp;
  const lastTs = sorted[sorted.length - 1].timestamp;
  const timeSpanSeconds = Math.max(1, (lastTs - firstTs) / 1000);
  const avgIntervalSeconds = timeSpanSeconds / Math.max(1, prices.length - 1);

  // 年化：假设平均每avgIntervalSeconds秒一个数据点
  // 一年的秒数 / 平均间隔 = 每年的数据点数
  const periodsPerYear = (365.25 * 24 * 3600) / Math.max(1, avgIntervalSeconds);
  const annualizedVol = stdDev * Math.sqrt(periodsPerYear);

  // 限制在合理范围内（5% - 500%）
  return Math.max(0.05, Math.min(5.0, annualizedVol));
}

/**
 * 计算历史数据的覆盖时间（秒）
 */
function getHistoryDuration(priceHistory: PriceTick[]): number {
  if (priceHistory.length < 2) return 0;
  const sorted = [...priceHistory].sort((a, b) => a.timestamp - b.timestamp);
  return (sorted[sorted.length - 1].timestamp - sorted[0].timestamp) / 1000;
}

/**
 * 计算波动率的稳定性（变异系数）
 */
function calculateVolatilityStability(priceHistory: PriceTick[]): number {
  if (priceHistory.length < 10) return 0.5; // 数据不足时，假设中等稳定性

  const sorted = [...priceHistory].sort((a, b) => a.timestamp - b.timestamp);

  // 将数据分成多个窗口，计算每个窗口的波动率
  const windowSize = Math.max(5, Math.floor(sorted.length / 5));
  const volatilities: number[] = [];

  for (let i = 0; i < sorted.length - windowSize; i += windowSize) {
    const window = sorted.slice(i, i + windowSize);
    const vol = calculateVolatility(window);
    volatilities.push(vol);
  }

  if (volatilities.length < 2) return 0.5;

  // 计算波动率的变异系数（标准差/均值）
  const mean = volatilities.reduce((sum, v) => sum + v, 0) / volatilities.length;
  let variance = 0;
  for (const v of volatilities) {
    variance += Math.pow(v - mean, 2);
  }
  variance /= volatilities.length - 1;
  const stdDev = Math.sqrt(variance);

  // 变异系数越小，稳定性越高
  const coefficientOfVariation = mean > 0 ? stdDev / mean : 1;

  // 转换为稳定性分数（0-1），变异系数越小，稳定性分数越高
  return Math.max(0, Math.min(1, 1 / (1 + coefficientOfVariation)));
}

// ------------------------- BSM核心计算 -------------------------

/**
 * 使用BSM模型计算二元期权的概率
 * 对于二元期权，我们需要计算 P(S_T >= K)
 *
 * BSM模型假设价格遵循几何布朗运动：
 * dS = r*S*dt + σ*S*dW
 *
 * 对数价格在到期时的分布：
 * ln(S_T) ~ N(ln(S_0) + (r - 0.5*σ²)*T, σ²*T)
 *
 * Up概率：P(S_T >= K) = N(d2)
 * 其中 d2 = (ln(S_0/K) + (r - 0.5*σ²)*T) / (σ*√T)
 */
function calculateBSMProbability(params: BSMParams): { probUp: number; probDown: number } {
  const { currentPrice, strikePrice, timeToExpiry, volatility, riskFreeRate = 0 } = params;

  // 参数校验
  if (currentPrice <= 0 || strikePrice <= 0 || timeToExpiry <= 0 || volatility <= 0) {
    return { probUp: 0.5, probDown: 0.5 };
  }

  // 如果时间非常接近0，直接比较当前价格和执行价格
  if (timeToExpiry < 1e-6) {
    return {
      probUp: currentPrice >= strikePrice ? 1 : 0,
      probDown: currentPrice < strikePrice ? 1 : 0,
    };
  }

  // 计算d2
  const logS0K = Math.log(currentPrice / strikePrice);
  const sigmaSqrtT = volatility * Math.sqrt(timeToExpiry);

  // 如果波动率为0或时间接近0，根据当前价格判断
  if (sigmaSqrtT < 1e-10) {
    return {
      probUp: currentPrice >= strikePrice ? 1 : 0,
      probDown: currentPrice < strikePrice ? 1 : 0,
    };
  }

  const d2 = (logS0K + (riskFreeRate - 0.5 * volatility * volatility) * timeToExpiry) / sigmaSqrtT;

  // P(S_T >= K) = N(d2)
  const probUp = normalCdf(d2);
  const probDown = 1 - probUp;

  // 数值稳定性处理
  return {
    probUp: Math.max(0, Math.min(1, probUp)),
    probDown: Math.max(0, Math.min(1, probDown)),
  };
}

/**
 * 计算模型置信度
 * 综合考虑：数据量、历史覆盖时间、波动率稳定性、剩余时间
 */
function calculateConfidence(priceHistory: PriceTick[], timeToExpiryMs: number): number {
  const dataPoints = priceHistory.length;
  const historyDuration = getHistoryDuration(priceHistory);
  const volStability = calculateVolatilityStability(priceHistory);

  // 将毫秒转换为秒
  const timeToExpirySeconds = timeToExpiryMs / 1000;

  // 1. 数据量因子 (0-1)
  // 数据点越多，置信度越高
  const dataFactor = Math.min(1, dataPoints / 50); // 50个数据点为满分

  // 2. 历史覆盖时间因子 (0-1)
  // 历史数据覆盖的时间越长，置信度越高（但边际递减）
  // 理想情况下，历史数据应该覆盖至少几分钟
  const idealHistorySeconds = 300; // 5分钟
  const historyFactor = Math.min(1, historyDuration / idealHistorySeconds);

  // 3. 波动率稳定性因子 (0-1)
  // 波动率越稳定，置信度越高
  const stabilityFactor = volStability;

  // 4. 剩余时间因子 (0-1)
  // 剩余时间越短，不确定性可能越大（但如果是确定性事件，可能置信度更高）
  // 这里采用一个折中：剩余时间在合理范围内（1秒到10分钟）时置信度较高
  let timeFactor = 1;
  if (timeToExpirySeconds < 1) {
    timeFactor = 0.7; // 时间太短，可能有延迟不确定性
  } else if (timeToExpirySeconds < 60) {
    timeFactor = 0.9; // 1分钟内，较高置信度
  } else if (timeToExpirySeconds > 600) {
    timeFactor = 0.8; // 超过10分钟，不确定性增加
  }

  // 综合置信度（加权平均）
  const confidence =
    dataFactor * 0.3 + historyFactor * 0.3 + stabilityFactor * 0.25 + timeFactor * 0.15;

  return Math.max(0, Math.min(1, confidence));
}

// ------------------------- 主函数 -------------------------

/**
 * BSM模型主函数
 *
 * @param priceHistory 历史价格列表，格式：{value: number, timestamp: number}[]
 * @param strikePrice 对赌价格（执行价格）
 * @param timeToExpiryMs 剩余时间（毫秒）
 * @param riskFreeRate 无风险利率（年化），默认0（适用于加密货币市场）
 * @param lookbackSeconds 计算波动率时的回看时间（秒），0表示使用全部历史数据
 * @returns BSM计算结果，包含Up概率、Down概率和置信度
 */
export function calculateBSM(
  priceHistory: PriceTick[],
  strikePrice: number,
  timeToExpiryMs: number,
  riskFreeRate: number = 0,
  lookbackSeconds: number = 0
): BSMResult {
  // 参数校验
  if (!priceHistory || priceHistory.length === 0) {
    return {
      probUp: 0.5,
      probDown: 0.5,
      confidence: 0,
    };
  }

  if (strikePrice <= 0 || timeToExpiryMs < 0) {
    return {
      probUp: 0.5,
      probDown: 0.5,
      confidence: 0,
    };
  }

  // 获取当前价格（最新的价格）
  const sorted = [...priceHistory].sort((a, b) => a.timestamp - b.timestamp);
  const currentPrice = sorted[sorted.length - 1].value;

  if (currentPrice <= 0) {
    return {
      probUp: 0.5,
      probDown: 0.5,
      confidence: 0,
    };
  }

  // 计算波动率
  const volatility = calculateVolatility(priceHistory, lookbackSeconds);

  // 将剩余时间从毫秒转换为秒，再转换为年化（以年为单位）
  const timeToExpirySeconds = timeToExpiryMs / 1000;
  const timeToExpiryYears = timeToExpirySeconds / (365.25 * 24 * 3600);

  // 计算BSM概率
  const { probUp, probDown } = calculateBSMProbability({
    currentPrice,
    strikePrice,
    timeToExpiry: timeToExpiryYears,
    volatility,
    riskFreeRate,
  });

  // 计算置信度
  const confidence = calculateConfidence(priceHistory, timeToExpiryMs);

  return {
    probUp,
    probDown,
    confidence,
  };
}

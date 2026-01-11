/**
 * 基于历史价格数据的概率预测模型
 * 用于计算价格在到期时高于或低于基线价格的概率
 */

/**
 * 历史价格数据接口
 */
export interface PriceData {
  value: number;
  timestamp: number;
}

/**
 * 计算结果接口
 */
export interface ProbabilityResult {
  probUp: number; // 价格高于baseline的概率
  probDown: number; // 价格低于baseline的概率
  confidence: number; // 置信度 (0-1)
}

/**
 * 计算参数接口
 */
export interface CalculationParams {
  priceHistory: PriceData[];
  baselinePrice: number;
  timeToExpiryMs: number;
}

/**
 * 标准正态分布的累积分布函数 (CDF)
 * 使用误差函数近似实现
 */
function normalCdf(x: number): number {
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

  return 0.5 * (1 + sign * y);
}

/**
 * 从历史价格数据计算波动率（年化）
 * 处理非等间隔时间序列数据
 */
function calculateVolatility(priceHistory: PriceData[]): number {
  if (priceHistory.length < 2) {
    return 0.3; // 默认波动率30%（年化）
  }

  // 按时间戳排序
  const sorted = [...priceHistory].sort((a, b) => a.timestamp - b.timestamp);

  // 过滤掉无效价格
  const validPrices = sorted.filter((p) => p.value > 0);
  if (validPrices.length < 2) {
    return 0.3;
  }

  // 计算对数收益率，考虑实际时间间隔
  const logReturns: number[] = [];
  const timeIntervals: number[] = [];

  for (let i = 1; i < validPrices.length; i++) {
    const prev = validPrices[i - 1];
    const curr = validPrices[i];
    const timeDiff = (curr.timestamp - prev.timestamp) / 1000; // 转换为秒

    if (prev.value > 0 && curr.value > 0 && timeDiff > 0) {
      logReturns.push(Math.log(curr.value / prev.value));
      timeIntervals.push(timeDiff);
    }
  }

  if (logReturns.length === 0) {
    return 0.3;
  }

  // 计算加权平均时间间隔（秒）
  const totalTime = timeIntervals.reduce((sum, t) => sum + t, 0);
  const avgIntervalSeconds = totalTime / timeIntervals.length;

  // 计算对数收益率的标准差
  const mean = logReturns.reduce((sum, r) => sum + r, 0) / logReturns.length;
  let variance = 0;
  for (const r of logReturns) {
    const diff = r - mean;
    variance += diff * diff;
  }
  variance /= Math.max(1, logReturns.length - 1);
  const stdDev = Math.sqrt(variance);

  // 年化波动率
  // 将标准差按平均时间间隔标准化到年化
  const secondsPerYear = 365.25 * 24 * 3600;
  const periodsPerYear = secondsPerYear / Math.max(1, avgIntervalSeconds);
  const annualizedVol = stdDev * Math.sqrt(periodsPerYear);

  // 限制在合理范围内（5% - 500%）
  return Math.max(0.05, Math.min(5.0, annualizedVol));
}

/**
 * 获取当前价格（最新价格）
 */
function getCurrentPrice(priceHistory: PriceData[]): number {
  if (priceHistory.length === 0) {
    return 0;
  }
  const sorted = [...priceHistory].sort((a, b) => a.timestamp - b.timestamp);
  return sorted[sorted.length - 1].value;
}

/**
 * 计算历史数据的覆盖时间（秒）
 */
function getHistoryDuration(priceHistory: PriceData[]): number {
  if (priceHistory.length < 2) {
    return 0;
  }
  const sorted = [...priceHistory].sort((a, b) => a.timestamp - b.timestamp);
  return (sorted[sorted.length - 1].timestamp - sorted[0].timestamp) / 1000;
}

/**
 * 计算数据质量指标
 */
function calculateDataQuality(priceHistory: PriceData[]): {
  dataPoints: number;
  duration: number;
  density: number; // 数据密度（点数/秒）
} {
  const dataPoints = priceHistory.length;
  const duration = getHistoryDuration(priceHistory);
  const density = duration > 0 ? dataPoints / duration : 0;

  return { dataPoints, duration, density };
}

/**
 * 使用BSM模型计算概率
 * 基于几何布朗运动假设
 */
function calculateBSMProbability(
  currentPrice: number,
  baselinePrice: number,
  timeToExpiryYears: number,
  volatility: number
): { probUp: number; probDown: number } {
  // 参数校验
  if (currentPrice <= 0 || baselinePrice <= 0 || timeToExpiryYears <= 0 || volatility <= 0) {
    return { probUp: 0.5, probDown: 0.5 };
  }

  // 如果时间非常接近0，直接比较当前价格和基线价格
  if (timeToExpiryYears < 1e-8) {
    return {
      probUp: currentPrice >= baselinePrice ? 1 : 0,
      probDown: currentPrice < baselinePrice ? 1 : 0,
    };
  }

  // 计算 d2 (BSM模型中的参数)
  const logS0K = Math.log(currentPrice / baselinePrice);
  const sigmaSqrtT = volatility * Math.sqrt(timeToExpiryYears);

  if (sigmaSqrtT < 1e-10) {
    return {
      probUp: currentPrice >= baselinePrice ? 1 : 0,
      probDown: currentPrice < baselinePrice ? 1 : 0,
    };
  }

  // 假设无风险利率为0（适用于加密货币市场）
  const riskFreeRate = 0;
  const d2 =
    (logS0K + (riskFreeRate - 0.5 * volatility * volatility) * timeToExpiryYears) / sigmaSqrtT;

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
 * 计算置信度
 * 综合考虑：数据量、历史覆盖时间、数据密度、剩余时间
 */
function calculateConfidence(priceHistory: PriceData[], timeToExpiryMs: number): number {
  const quality = calculateDataQuality(priceHistory);
  const timeToExpirySeconds = timeToExpiryMs / 1000;

  // 1. 数据量因子 (0-1)
  // 数据点越多，置信度越高
  const dataFactor = Math.min(1, quality.dataPoints / 30); // 30个数据点为满分

  // 2. 历史覆盖时间因子 (0-1)
  // 历史数据覆盖的时间越长，置信度越高
  const idealHistorySeconds = 300; // 5分钟为理想值
  const historyFactor = Math.min(1, quality.duration / idealHistorySeconds);

  // 3. 数据密度因子 (0-1)
  // 数据密度越高（点数/秒），置信度越高
  const idealDensity = 0.5; // 理想密度：每2秒一个点
  const densityFactor = Math.min(1, quality.density / idealDensity);

  // 4. 剩余时间因子 (0-1)
  // 剩余时间在合理范围内时置信度较高
  let timeFactor = 1;
  if (timeToExpirySeconds < 0.1) {
    timeFactor = 0.3; // 时间太短，不确定性强
  } else if (timeToExpirySeconds < 1) {
    timeFactor = 0.6;
  } else if (timeToExpirySeconds < 60) {
    timeFactor = 0.9; // 1分钟内，较高置信度
  } else if (timeToExpirySeconds > 600) {
    timeFactor = 0.7; // 超过10分钟，不确定性增加
  }

  // 综合置信度（加权平均）
  const confidence =
    dataFactor * 0.3 + historyFactor * 0.25 + densityFactor * 0.25 + timeFactor * 0.2;

  return Math.max(0, Math.min(1, confidence));
}

/**
 * 主函数：计算价格在到期时高于或低于基线价格的概率
 *
 * @param priceHistory 历史价格数据，格式：{value: number, timestamp: number}[]
 * @param baselinePrice 基线价格
 * @param timeToExpiryMs 剩余时间（毫秒）
 * @returns 概率计算结果，包含probUp、probDown和confidence
 */
export function calculateProbabilityBasedOnBSM(
  priceHistory: PriceData[],
  baselinePrice: number,
  timeToExpiryMs: number
): ProbabilityResult {
  // 参数校验
  if (!priceHistory || priceHistory.length === 0) {
    return {
      probUp: 0.5,
      probDown: 0.5,
      confidence: 0,
    };
  }

  if (baselinePrice <= 0 || timeToExpiryMs < 0) {
    return {
      probUp: 0.5,
      probDown: 0.5,
      confidence: 0,
    };
  }

  // 获取当前价格（最新的价格）
  const currentPrice = getCurrentPrice(priceHistory);
  if (currentPrice <= 0) {
    return {
      probUp: 0.5,
      probDown: 0.5,
      confidence: 0,
    };
  }

  // 计算波动率
  const volatility = calculateVolatility(priceHistory);

  // 将剩余时间从毫秒转换为年化（以年为单位）
  const timeToExpirySeconds = timeToExpiryMs / 1000;
  const timeToExpiryYears = timeToExpirySeconds / (365.25 * 24 * 3600);

  // 计算BSM概率
  const { probUp, probDown } = calculateBSMProbability(
    currentPrice,
    baselinePrice,
    timeToExpiryYears,
    volatility
  );

  // 计算置信度
  const confidence = calculateConfidence(priceHistory, timeToExpiryMs);

  return {
    probUp,
    probDown,
    confidence,
  };
}

import { PricePoint } from "./Aligner";

/**
 * 价格变化趋势
 */
export enum PriceTrend {
  /**
   * 上涨趋势
   */
  Up = "up",
  /**
   * 下跌趋势
   */
  Down = "down",
  /**
   * 无趋势/震荡
   */
  Neutral = "neutral",
}

/**
 * 突破类型
 */
export enum BreakthroughType {
  /**
   * 真实突破
   */
  Real = "real",
  /**
   * 假突破
   */
  Fake = "fake",
  /**
   * 未突破（变化幅度不够）
   */
  None = "none",
}

/**
 * 价格波动检测结果
 */
export interface PriceChangeDetection {
  /**
   * 价格变化趋势
   */
  trend: PriceTrend;
  /**
   * 突破类型
   */
  breakthroughType: BreakthroughType;
  /**
   * 价格变化幅度（绝对值）
   */
  changeAmount: number;
  /**
   * 价格变化率（百分比）
   */
  changeRate: number;
  /**
   * 基准价格（用于计算变化的起始价格）
   */
  basePrice: number;
  /**
   * 最新价格
   */
  currentPrice: number;
  /**
   * 最大回撤比例（相对于初始变化）
   * 例如：如果初始变化+1%，后续回撤-0.3%，则pullbackRatio = 0.3
   */
  pullbackRatio: number;
  /**
   * 价格稳定性（最近N个点的标准差，越小越稳定）
   */
  stability: number;
  /**
   * 是否确认突破（价格变化持续且稳定）
   */
  isConfirmed: boolean;
  /**
   * 置信度（0-1，值越大表示判断越可靠）
   */
  confidence: number;
}

/**
 * 价格波动检测配置
 */
export interface PriceChangeDetectionConfig {
  /**
   * 触发检测的最小变化率阈值（百分比，如0.5表示0.5%）
   * 低于此阈值不认为是突破
   */
  minChangeRateThreshold?: number;
  /**
   * 回撤阈值（相对于初始变化的比例，如0.3表示30%）
   * 如果回撤超过此阈值，判定为假突破
   */
  pullbackThreshold?: number;
  /**
   * 用于计算稳定性的最近数据点数量
   */
  stabilityWindowSize?: number;
  /**
   * 稳定性阈值（标准差，小于此值认为价格稳定）
   */
  stabilityThreshold?: number;
  /**
   * 用于计算趋势的最近数据点数量
   */
  trendWindowSize?: number;
}

/**
 * 计算数组的均值
 */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * 计算数组的标准差
 */
function stdDev(values: number[], meanValue?: number): number {
  if (values.length === 0) return 0;
  const m = meanValue !== undefined ? meanValue : mean(values);
  const variance = values.reduce((sum, val) => sum + Math.pow(val - m, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * 检测价格波动趋势和真假突破
 * 从价格列表中判断最近价格的突破趋势
 *
 * @param priceList 价格列表（按时间戳排序，包含历史价格和最新价格）
 * @param config 检测配置
 * @returns 价格波动检测结果
 *
 * @example
 * ```typescript
 * const priceList = [
 *   { value: 50000, timestamp: 1000 },
 *   { value: 50010, timestamp: 2000 },
 *   { value: 50020, timestamp: 3000 },
 *   { value: 50030, timestamp: 4000 }, // 最新价格
 * ];
 *
 * const result = detectPriceChange(priceList, {
 *   minChangeRateThreshold: 0.5,
 *   pullbackThreshold: 0.3,
 * });
 *
 * // result.trend: PriceTrend.Up
 * // result.breakthroughType: BreakthroughType.Real
 * ```
 */
export function detectPriceChange(
  priceList: PricePoint[],
  config: PriceChangeDetectionConfig = {}
): PriceChangeDetection {
  const {
    minChangeRateThreshold = 0.5, // 默认0.5%
    pullbackThreshold = 0.3, // 默认30%
    stabilityWindowSize = 5, // 默认最近5个点
    stabilityThreshold = 0.002, // 默认0.2%
    trendWindowSize = 10, // 默认最近10个点
  } = config;

  // 参数验证
  if (priceList.length === 0) {
    throw new Error("价格列表不能为空");
  }

  if (priceList.length < 2) {
    // 如果只有一个价格点，无法判断趋势
    return {
      trend: PriceTrend.Neutral,
      breakthroughType: BreakthroughType.None,
      changeAmount: 0,
      changeRate: 0,
      basePrice: priceList[0].value,
      currentPrice: priceList[0].value,
      pullbackRatio: 0,
      stability: 0,
      isConfirmed: false,
      confidence: 0,
    };
  }

  // 确保价格列表按时间戳排序
  const sortedPrices = [...priceList].sort((a, b) => a.timestamp - b.timestamp);

  // 获取最新价格（最后一个点）
  const latestPrice = sortedPrices[sortedPrices.length - 1].value;
  const latestTimestamp = sortedPrices[sortedPrices.length - 1].timestamp;

  // 获取历史价格（除了最后一个点的所有点）
  const historicalPrices = sortedPrices.slice(0, -1).map((p) => p.value);

  // 确定基准价格（使用历史价格的均值作为基准）
  const basePrice = mean(historicalPrices);

  // 计算价格变化
  const changeAmount = latestPrice - basePrice;
  const changeRate = (changeAmount / basePrice) * 100;

  // 判断是否达到最小变化阈值
  if (Math.abs(changeRate) < minChangeRateThreshold) {
    return {
      trend: PriceTrend.Neutral,
      breakthroughType: BreakthroughType.None,
      changeAmount,
      changeRate,
      basePrice,
      currentPrice: latestPrice,
      pullbackRatio: 0,
      stability: 0,
      isConfirmed: false,
      confidence: 0,
    };
  }

  // 确定变化方向
  const isUpward = changeAmount > 0;

  // 计算趋势（使用最近N个点，包括最新价格）
  const allPriceValues = sortedPrices.map((p) => p.value);
  const recentPrices = allPriceValues.slice(-trendWindowSize);
  const trendPrices = recentPrices;

  // 计算趋势：使用线性回归斜率或简单比较
  let trend: PriceTrend;
  if (trendPrices.length >= 2) {
    const firstHalf = trendPrices.slice(0, Math.floor(trendPrices.length / 2));
    const secondHalf = trendPrices.slice(Math.floor(trendPrices.length / 2));

    const firstHalfMean = mean(firstHalf);
    const secondHalfMean = mean(secondHalf);

    const trendChange = ((secondHalfMean - firstHalfMean) / firstHalfMean) * 100;

    if (Math.abs(trendChange) < 0.1) {
      trend = PriceTrend.Neutral;
    } else if (trendChange > 0) {
      trend = PriceTrend.Up;
    } else {
      trend = PriceTrend.Down;
    }
  } else {
    trend = isUpward ? PriceTrend.Up : PriceTrend.Down;
  }

  // 计算回撤（检查最近价格中是否有回调）
  let maxPullback = 0;
  const initialChange = changeAmount;

  if (allPriceValues.length >= 2) {
    // 找到价格变化的峰值/谷值（在最近的价格中）
    const recentPriceValues = allPriceValues.slice(-trendWindowSize);
    let peakPrice = isUpward ? Math.max(...recentPriceValues) : Math.min(...recentPriceValues);
    let peakIndex = recentPriceValues.indexOf(peakPrice);

    // 检查峰值之后是否有回撤
    if (peakIndex < recentPriceValues.length - 1) {
      const afterPeak = recentPriceValues.slice(peakIndex + 1);
      if (isUpward) {
        // 上涨后，检查是否有下跌
        const minAfterPeak = afterPeak.length > 0 ? Math.min(...afterPeak) : latestPrice;
        const pullback = peakPrice - minAfterPeak;
        maxPullback = initialChange > 0 ? pullback / Math.abs(initialChange) : 0;
      } else {
        // 下跌后，检查是否有上涨
        const maxAfterPeak = afterPeak.length > 0 ? Math.max(...afterPeak) : latestPrice;
        const pullback = maxAfterPeak - peakPrice;
        maxPullback = initialChange < 0 ? pullback / Math.abs(initialChange) : 0;
      }
    }
  }

  // 计算稳定性（最近N个点的标准差）
  const stabilityPrices = trendPrices.slice(-stabilityWindowSize);
  const stabilityStd = stdDev(stabilityPrices);
  const stability = (stabilityStd / mean(stabilityPrices)) * 100; // 相对波动率（百分比）

  // 判断是否为假突破
  let breakthroughType: BreakthroughType;
  let isConfirmed: boolean;
  let confidence: number;

  // 回撤超过阈值，判定为假突破
  if (maxPullback > pullbackThreshold) {
    breakthroughType = BreakthroughType.Fake;
    isConfirmed = false;
    confidence = 1 - Math.min(maxPullback, 1); // 回撤越大，置信度越低
  } else {
    // 回撤在阈值内，进一步判断
    const isStable = stability < stabilityThreshold;
    const isTrendConsistent =
      (isUpward && trend === PriceTrend.Up) || (!isUpward && trend === PriceTrend.Down);

    if (isStable && isTrendConsistent) {
      breakthroughType = BreakthroughType.Real;
      isConfirmed = true;
      // 稳定性越高，趋势越一致，置信度越高
      confidence = Math.min(0.9 + (1 - stability / stabilityThreshold) * 0.1, 1);
    } else if (isTrendConsistent) {
      breakthroughType = BreakthroughType.Real;
      isConfirmed = true;
      confidence = 0.7; // 趋势一致但不够稳定
    } else {
      // 趋势不一致，可能是假突破
      breakthroughType = BreakthroughType.Fake;
      isConfirmed = false;
      confidence = 0.5;
    }
  }

  return {
    trend,
    breakthroughType,
    changeAmount,
    changeRate,
    basePrice,
    currentPrice: latestPrice,
    pullbackRatio: maxPullback,
    stability,
    isConfirmed,
    confidence,
  };
}

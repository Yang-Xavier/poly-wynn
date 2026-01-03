/**
 * 价格数据点接口
 */
export interface PricePoint {
  value: number;
  timestamp: number;
}

/**
 * 价差分析结果
 */
export interface SpreadAnalysisResult {
  /**
   * 是否会引起B曲线变化
   */
  willChange: boolean;
  /**
   * 预测的B曲线变化幅度（相对于当前B价格的变化百分比）
   * 正数表示B价格会上涨，负数表示会下跌
   */
  predictedChangePercent: number;
  /**
   * 预测的B曲线新价格（绝对值）
   */
  predictedNewPrice: number;
  /**
   * 当前价差（A - B）
   */
  currentSpread: number;
  /**
   * 历史价差均值
   */
  meanSpread: number;
  /**
   * 历史价差标准差
   */
  stdSpread: number;
  /**
   * 当前价差的Z-score（偏离均值的标准差倍数）
   */
  zScore: number;
  /**
   * 置信度（0-1之间，值越大表示预测越可靠）
   */
  confidence: number;
}

/**
 * 价差预测器配置参数
 */
export interface SpreadPredictorConfig {
  /**
   * Z-score阈值，超过此值认为价差异常，会引起变化
   * 默认值为2.0（约95%置信区间）
   */
  zScoreThreshold?: number;
  /**
   * 最小历史数据点数量，少于此值不进行预测
   * 默认值为30
   */
  minDataPoints?: number;
  /**
   * 用于计算协整系数的数据点数量
   * 如果为0或undefined，使用全部历史数据
   * 默认值为0（使用全部数据）
   */
  regressionWindow?: number;
  /**
   * 置信度计算的最小Z-score
   * 默认值为1.0
   */
  minZScoreForConfidence?: number;
}

/**
 * 在已排序的数组中，使用二分查找找到最接近目标时间戳的点
 * 返回 {value, timestamp} 或 null
 */
function findClosestPoint(
  points: PricePoint[],
  targetTimestamp: number,
  maxTimeDiff: number = Infinity
): PricePoint | null {
  if (points.length === 0) return null;

  // 如果只有一个点，直接返回
  if (points.length === 1) {
    return Math.abs(points[0].timestamp - targetTimestamp) <= maxTimeDiff ? points[0] : null;
  }

  // 二分查找最接近的点
  let left = 0;
  let right = points.length - 1;
  let closest = points[0];
  let minDiff = Math.abs(points[0].timestamp - targetTimestamp);

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const diff = Math.abs(points[mid].timestamp - targetTimestamp);

    if (diff < minDiff) {
      minDiff = diff;
      closest = points[mid];
    }

    if (points[mid].timestamp < targetTimestamp) {
      left = mid + 1;
    } else if (points[mid].timestamp > targetTimestamp) {
      right = mid - 1;
    } else {
      // 完全匹配
      return points[mid];
    }
  }

  // 检查相邻的点，看是否有更接近的
  const closestIndex = points.indexOf(closest);
  if (closestIndex > 0) {
    const prevDiff = Math.abs(points[closestIndex - 1].timestamp - targetTimestamp);
    if (prevDiff < minDiff) {
      closest = points[closestIndex - 1];
      minDiff = prevDiff;
    }
  }
  if (closestIndex < points.length - 1) {
    const nextDiff = Math.abs(points[closestIndex + 1].timestamp - targetTimestamp);
    if (nextDiff < minDiff) {
      closest = points[closestIndex + 1];
      minDiff = nextDiff;
    }
  }

  return minDiff <= maxTimeDiff ? closest : null;
}

/**
 * 使用线性插值计算指定时间戳的价格值（已排序的数组）
 * 使用二分查找优化性能
 */
function interpolateValue(points: PricePoint[], targetTimestamp: number): number | null {
  if (points.length === 0) return null;

  // 二分查找找到插入位置
  let left = 0;
  let right = points.length - 1;
  let insertPos = points.length;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (points[mid].timestamp === targetTimestamp) {
      return points[mid].value; // 精确匹配
    } else if (points[mid].timestamp < targetTimestamp) {
      left = mid + 1;
    } else {
      insertPos = mid;
      right = mid - 1;
    }
  }

  // insertPos 是第一个大于 targetTimestamp 的位置
  if (insertPos === 0) {
    // 所有点的时间戳都大于目标时间，返回第一个点
    return points[0].value;
  }
  if (insertPos === points.length) {
    // 所有点的时间戳都小于目标时间，返回最后一个点
    return points[points.length - 1].value;
  }

  // 进行线性插值
  const beforePoint = points[insertPos - 1];
  const afterPoint = points[insertPos];
  const ratio =
    (targetTimestamp - beforePoint.timestamp) / (afterPoint.timestamp - beforePoint.timestamp);
  return beforePoint.value + (afterPoint.value - beforePoint.value) * ratio;
}

/**
 * 对齐两条价格曲线的时间戳，返回对齐后的数据
 * 使用最近邻匹配和线性插值的方法
 * 对于A曲线的每个点，找到B曲线中时间最接近的点（在时间窗口内）
 */
function alignPriceData(
  curveA: PricePoint[],
  curveB: PricePoint[],
  maxTimeWindow: number = 5000 // 最大时间窗口（毫秒），默认5秒
): { alignedA: PricePoint[]; alignedB: PricePoint[] } {
  if (curveA.length === 0 || curveB.length === 0) {
    return { alignedA: [], alignedB: [] };
  }

  // 确保数据按时间戳排序
  const sortedA = [...curveA].sort((a, b) => a.timestamp - b.timestamp);
  const sortedB = [...curveB].sort((a, b) => a.timestamp - b.timestamp);

  const alignedA: PricePoint[] = [];
  const alignedB: PricePoint[] = [];

  // 使用优化的双指针方法，对于A的每个点，找到B中时间最接近的点
  let bIndex = 0; // B曲线的当前指针位置
  for (const pointA of sortedA) {
    // 先尝试在当前位置附近查找（因为数据已排序，B的指针只会前进）
    let bestBPoint: PricePoint | null = null;
    let minTimeDiff = Infinity;
    let bestBIndex = bIndex;

    // 从当前位置向前查找（最多向前10个点，向后查找50个点）
    const searchStart = Math.max(0, bIndex - 10);
    const searchEnd = Math.min(sortedB.length, bIndex + 50);

    for (let i = searchStart; i < searchEnd; i++) {
      const timeDiff = Math.abs(sortedB[i].timestamp - pointA.timestamp);
      if (timeDiff < minTimeDiff) {
        minTimeDiff = timeDiff;
        bestBPoint = sortedB[i];
        bestBIndex = i;
      }
      // 如果时间戳已经超过A的时间戳很多，可以提前终止（因为数据已排序）
      if (sortedB[i].timestamp > pointA.timestamp + maxTimeWindow && i > bIndex) {
        break;
      }
    }

    // 更新B的指针位置（向前移动，但不要回退太多）
    bIndex = Math.max(bestBIndex - 5, bIndex);

    // 如果时间差在允许范围内，使用该点；否则使用插值
    if (bestBPoint && minTimeDiff <= maxTimeWindow) {
      alignedA.push(pointA);
      alignedB.push(bestBPoint);
    } else {
      // 时间差太大，使用插值
      const interpolatedB = interpolateValue(sortedB, pointA.timestamp);
      if (interpolatedB !== null) {
        alignedA.push(pointA);
        alignedB.push({ value: interpolatedB, timestamp: pointA.timestamp });
      }
    }
  }

  return { alignedA, alignedB };
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
 * 使用简单线性回归计算A对B的协整系数
 * B = alpha + beta * A + error
 * 返回 {alpha, beta, rSquared}
 */
function linearRegression(
  xValues: number[],
  yValues: number[]
): { alpha: number; beta: number; rSquared: number } {
  if (xValues.length !== yValues.length || xValues.length === 0) {
    return { alpha: 0, beta: 1, rSquared: 0 };
  }

  const n = xValues.length;
  const meanX = mean(xValues);
  const meanY = mean(yValues);

  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;

  for (let i = 0; i < n; i++) {
    const dx = xValues[i] - meanX;
    const dy = yValues[i] - meanY;
    sumXY += dx * dy;
    sumXX += dx * dx;
    sumYY += dy * dy;
  }

  const beta = sumXX === 0 ? 1 : sumXY / sumXX;
  const alpha = meanY - beta * meanX;
  const rSquared = sumXX === 0 || sumYY === 0 ? 0 : Math.pow(sumXY, 2) / (sumXX * sumYY);

  return { alpha, beta, rSquared };
}

/**
 * 价差预测器：预测A曲线价格变化是否会引起B曲线变化
 * 
 * 该算法基于价差分析和线性回归模型：
 * 1. 对齐两条曲线的时间戳（使用最近邻匹配和线性插值）
 * 2. 计算历史价差统计特征（均值、标准差）
 * 3. 使用Z-score检测当前价差是否异常
 * 4. 结合线性回归和价差均值回归预测B曲线的变化
 *
 * @param curveA A曲线的历史价格数据
 * @param curveB B曲线的历史价格数据
 * @param currentPriceA A曲线当前价格
 * @param currentPriceB B曲线当前价格
 * @param config 配置参数
 * @returns 价差分析结果
 */
export function predictSpreadChange(
  curveA: PricePoint[],
  curveB: PricePoint[],
  currentPriceA: number,
  currentPriceB: number,
  config: SpreadPredictorConfig = {}
): SpreadAnalysisResult {
  const {
    zScoreThreshold = 2.0,
    minDataPoints = 30,
    regressionWindow = 0,
    minZScoreForConfidence = 1.0,
  } = config;

  // 默认返回值
  const defaultResult: SpreadAnalysisResult = {
    willChange: false,
    predictedChangePercent: 0,
    predictedNewPrice: currentPriceB,
    currentSpread: currentPriceA - currentPriceB,
    meanSpread: 0,
    stdSpread: 0,
    zScore: 0,
    confidence: 0,
  };

  // 数据不足
  if (curveA.length < minDataPoints || curveB.length < minDataPoints) {
    return defaultResult;
  }

  // 对齐时间戳
  const { alignedA, alignedB } = alignPriceData(curveA, curveB);
  if (alignedA.length < minDataPoints) {
    return defaultResult;
  }

  // 确定用于回归分析的数据范围
  const dataToUse =
    regressionWindow > 0 && alignedA.length > regressionWindow
      ? {
          a: alignedA.slice(-regressionWindow),
          b: alignedB.slice(-regressionWindow),
        }
      : { a: alignedA, b: alignedB };

  // 计算历史价差序列（A - B）
  const spreads = dataToUse.a.map((point, index) => point.value - dataToUse.b[index].value);

  // 计算价差的统计特征
  const meanSpread = mean(spreads);
  const stdSpread = stdDev(spreads, meanSpread);

  // 如果标准差为0，说明价差完全稳定，无需调整
  if (stdSpread === 0) {
    const currentSpread = currentPriceA - currentPriceB;
    const spreadDiff = currentSpread - meanSpread;
    return {
      willChange: Math.abs(spreadDiff) > 0.0001, // 允许小的浮点误差
      predictedChangePercent: (spreadDiff / currentPriceB) * 100,
      predictedNewPrice: currentPriceB + spreadDiff,
      currentSpread,
      meanSpread,
      stdSpread: 0,
      zScore:
        stdSpread === 0 ? (Math.abs(spreadDiff) > 0.0001 ? Infinity : 0) : spreadDiff / stdSpread,
      confidence: stdSpread === 0 ? 1.0 : 0,
    };
  }

  // 计算当前价差
  const currentSpread = currentPriceA - currentPriceB;

  // 计算Z-score
  const zScore = (currentSpread - meanSpread) / stdSpread;

  // 判断是否会引起变化（Z-score超过阈值）
  const willChange = Math.abs(zScore) > zScoreThreshold;

  // 使用线性回归预测B曲线的调整
  // 基于历史数据，建立A和B的线性关系：B = alpha + beta * A
  const aValues = dataToUse.a.map((p) => p.value);
  const bValues = dataToUse.b.map((p) => p.value);
  const regression = linearRegression(aValues, bValues);

  // 基于回归模型预测B的新价格
  // 如果当前价差异常，B会向回归预测值调整
  const predictedPriceByRegression = regression.alpha + regression.beta * currentPriceA;

  // 基于价差均值回归预测B的新价格
  // 如果价差偏离均值，B会调整以恢复价差均值
  const targetSpread = meanSpread;
  const predictedPriceBySpread = currentPriceA - targetSpread;

  // 综合两种预测方法（加权平均）
  // R²越高，回归模型的权重越大
  const regressionWeight = Math.min(regression.rSquared, 0.9); // 限制最大权重
  const spreadWeight = 1 - regressionWeight;

  const predictedNewPrice =
    predictedPriceByRegression * regressionWeight + predictedPriceBySpread * spreadWeight;

  // 计算预测的变化幅度（百分比）
  const predictedChangePercent = ((predictedNewPrice - currentPriceB) / currentPriceB) * 100;

  // 计算置信度
  // Z-score越大，置信度越高；R²越高，置信度也越高
  const zScoreBasedConfidence = Math.min(Math.abs(zScore) / (minZScoreForConfidence * 2), 1.0);
  const rSquaredBasedConfidence = regression.rSquared;
  const confidence = zScoreBasedConfidence * 0.6 + rSquaredBasedConfidence * 0.4;

  return {
    willChange,
    predictedChangePercent,
    predictedNewPrice,
    currentSpread,
    meanSpread,
    stdSpread,
    zScore,
    confidence,
  };
}

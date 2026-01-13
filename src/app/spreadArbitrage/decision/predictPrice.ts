import { PricePoint } from "./aggregateAndAlign";

/**
 * 价格预测结果
 */
export interface PricePredictionResult {
  /**
   * 补齐后的B价格列表（与A长度相同）
   */
  predictedB: PricePoint[];
  /**
   * 线性回归系数
   */
  regression: {
    alpha: number; // 截距
    beta: number; // 斜率
    rSquared: number; // R²（决定系数）
  };
}

/**
 * 计算数组的均值
 */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * 使用简单线性回归计算A对B的回归系数
 * B = alpha + beta * A + error
 * 返回 {alpha, beta, rSquared}
 */
function linearRegression(
  aValues: number[],
  bValues: number[]
): { alpha: number; beta: number; rSquared: number } {
  if (aValues.length !== bValues.length || aValues.length === 0) {
    return { alpha: 0, beta: 1, rSquared: 0 };
  }

  const n = aValues.length;
  const meanA = mean(aValues);
  const meanB = mean(bValues);

  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;

  for (let i = 0; i < n; i++) {
    const dx = aValues[i] - meanA;
    const dy = bValues[i] - meanB;
    sumXY += dx * dy;
    sumXX += dx * dx;
    sumYY += dy * dy;
  }

  const beta = sumXX === 0 ? 1 : sumXY / sumXX;
  const alpha = meanB - beta * meanA;
  const rSquared = sumXX === 0 || sumYY === 0 ? 0 : Math.pow(sumXY, 2) / (sumXX * sumYY);

  return { alpha, beta, rSquared };
}

/**
 * 使用A的历史价格预测B的价格，补齐B的列表
 *
 * @param priceListA A价格列表（较长）
 * @param priceListB B价格列表（较短，起始时间与A对齐）
 * @returns 预测结果，包含补齐后的B价格列表和回归系数
 *
 * @example
 * ```typescript
 * const priceListA = [
 *   { value: 50000, timestamp: 1000 },
 *   { value: 50010, timestamp: 2000 },
 *   { value: 50020, timestamp: 3000 },
 *   { value: 50030, timestamp: 4000 },
 *   { value: 50040, timestamp: 5000 },
 * ];
 *
 * const priceListB = [
 *   { value: 50005, timestamp: 1000 },
 *   { value: 50015, timestamp: 2000 },
 *   { value: 50025, timestamp: 3000 },
 * ];
 *
 * const result = predictPrice(priceListA, priceListB);
 * // result.predictedB 将包含5个点，前3个是原始B的价格，后2个是预测的价格
 * ```
 */
export function predictPrice(
  priceListA: PricePoint[],
  priceListB: PricePoint[]
): PricePredictionResult {
  // 参数验证
  if (priceListA.length === 0) {
    throw new Error("A价格列表不能为空");
  }

  if (priceListB.length === 0) {
    throw new Error("B价格列表不能为空");
  }

  if (priceListB.length >= priceListA.length) {
    throw new Error("B价格列表长度必须小于A价格列表长度");
  }

  // 确保价格列表按时间戳排序
  const sortedA = [...priceListA].sort((a, b) => a.timestamp - b.timestamp);
  const sortedB = [...priceListB].sort((a, b) => a.timestamp - b.timestamp);

  // 验证起始时间对齐
  if (sortedA[0].timestamp !== sortedB[0].timestamp) {
    throw new Error("A和B价格列表的起始时间必须对齐");
  }

  // 验证时间间隔一致
  if (sortedA.length >= 2 && sortedB.length >= 2) {
    const intervalA = sortedA[1].timestamp - sortedA[0].timestamp;
    const intervalB = sortedB[1].timestamp - sortedB[0].timestamp;
    if (intervalA !== intervalB) {
      throw new Error("A和B价格列表的时间间隔必须一致");
    }
  }

  // 获取A和B的历史价格（对齐的部分）
  const historicalA = sortedA.slice(0, sortedB.length).map((p) => p.value);
  const historicalB = sortedB.map((p) => p.value);

  // 使用线性回归计算A和B的关系
  const regression = linearRegression(historicalA, historicalB);

  // 补齐B的列表
  const predictedB: PricePoint[] = [];

  // 先添加B的原始数据
  for (let i = 0; i < sortedB.length; i++) {
    predictedB.push({
      value: sortedB[i].value,
      timestamp: sortedB[i].timestamp,
    });
  }

  // 预测B的未来价格（使用A的未来价格）
  const futureA = sortedA.slice(sortedB.length);
  for (let i = 0; i < futureA.length; i++) {
    const predictedValue = regression.alpha + regression.beta * futureA[i].value;
    predictedB.push({
      value: predictedValue,
      timestamp: futureA[i].timestamp,
    });
  }

  return {
    predictedB,
    regression,
  };
}

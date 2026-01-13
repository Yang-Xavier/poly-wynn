/**
 * 价格数据点接口
 */
export interface PricePoint {
  value: number;
  timestamp: number;
}

/**
 * 价格聚合对齐器配置
 */
export interface AlignerConfig {
  /**
   * 起始时间戳（毫秒）
   */
  startTimestamp: number;
  /**
   * 时间窗口（毫秒）
   */
  windowMs: number;
}

/**
 * 价格聚合对齐器
 * 用于按照时间窗口对价格数据进行聚合和对齐
 */
export class Aligner {
  private startTimestamp: number;
  private windowMs: number;
  private alignedData: PricePoint[] = [];
  private rawData: PricePoint[] = [];

  /**
   * 创建价格聚合对齐器实例
   *
   * @param startTimestamp 起始时间戳（毫秒）
   * @param windowMs 时间窗口（毫秒）
   */
  constructor(startTimestamp: number, windowMs: number) {
    if (windowMs <= 0) {
      throw new Error("时间窗口必须大于0");
    }

    this.startTimestamp = startTimestamp;
    this.windowMs = windowMs;
    this.alignedData = [];
    this.rawData = [];
  }

  /**
   * 按照起始时间和时间窗口对数据进行聚合
   * 聚合结果会缓存起来，通过 getAligned 方法获取
   * 时间复杂度：O(n)，其中 n 是数据点数量
   *
   * @param priceDataList 价格数据列表
   */
  align(priceDataList: PricePoint[]): void {
    // 清空之前的数据
    this.rawData = [...priceDataList];
    this.alignedData = [];

    if (priceDataList.length === 0) {
      return;
    }

    // 确保数据按时间戳排序
    const sortedData = [...priceDataList].sort((a, b) => a.timestamp - b.timestamp);

    // 找到数据的结束时间
    const endTimestamp = sortedData[sortedData.length - 1].timestamp;

    // 使用 Map 存储每个时间窗口内最接近末端的数据点
    // key: 时间窗口起始时间戳, value: 该窗口内最接近末端的数据点
    const windowDataMap = new Map<number, PricePoint>();

    // 第一次遍历：遍历所有数据点，确定每个数据点属于哪个时间窗口
    // 并记录每个窗口内最接近末端的数据点（时间戳最大的）
    for (const dataPoint of sortedData) {
      // 计算该数据点所属的时间窗口起始时间
      const windowStart =
        Math.floor((dataPoint.timestamp - this.startTimestamp) / this.windowMs) * this.windowMs +
        this.startTimestamp;

      // 如果窗口起始时间早于起始时间，跳过（不应该发生，但做安全检查）
      if (windowStart < this.startTimestamp) {
        continue;
      }

      // 获取该窗口当前记录的数据点
      const existing = windowDataMap.get(windowStart);

      // 如果没有记录，或者当前数据点更接近窗口末端（时间戳更大），则更新
      if (!existing || dataPoint.timestamp > existing.timestamp) {
        windowDataMap.set(windowStart, dataPoint);
      }
    }

    // 生成时间窗口序列（从起始时间开始，到数据结束时间）
    const timePoints: number[] = [];
    for (let t = this.startTimestamp; t <= endTimestamp; t += this.windowMs) {
      timePoints.push(t);
    }

    // 用于记录上一个窗口的价格（用于沿用）
    let lastValue: number | null = null;

    // 第二次遍历：生成对齐后的数据
    for (const timePoint of timePoints) {
      let aggregatedValue: number | null = null;

      // 检查该窗口是否有数据
      const windowData = windowDataMap.get(timePoint);
      if (windowData) {
        // 窗口内有数据，使用最接近窗口末端的数据
        aggregatedValue = windowData.value;
        lastValue = aggregatedValue;
      } else {
        // 窗口内没有数据，沿用上一个窗口的数据
        if (lastValue !== null) {
          aggregatedValue = lastValue;
        } else {
          // 如果第一个窗口就没有数据，尝试使用第一个可用值
          if (sortedData.length > 0) {
            aggregatedValue = sortedData[0].value;
            lastValue = aggregatedValue;
          }
        }
      }

      if (aggregatedValue !== null) {
        this.alignedData.push({
          value: aggregatedValue,
          timestamp: timePoint,
        });
      }
    }
  }

  /**
   * 获取对齐后的聚合数据
   *
   * @returns 对齐后的价格数据点数组
   */
  getAlignedData(): PricePoint[] {
    return [...this.alignedData];
  }

  /**
   * 添加最新的价格数据
   * 只处理两种情况：
   * 1. 数据在最后一个时间窗口内 -> 重新计算最后一个窗口的价格
   * 2. 数据在最后一个时间窗口后 -> 添加新窗口数据，沿用聚合规则
   * 其他情况则不添加数据
   *
   * @param priceData 最新的价格数据点
   */
  addData(priceData: PricePoint): void {
    // 如果还没有对齐数据，需要先进行对齐
    if (this.alignedData.length === 0) {
      this.rawData.push(priceData);
      this.align(this.rawData);
      return;
    }

    // 获取最后一个时间窗口的起始时间
    const lastWindowStart = this.alignedData[this.alignedData.length - 1].timestamp;
    const lastWindowEnd = lastWindowStart + this.windowMs;
    const newTimestamp = priceData.timestamp;

    // 情况1：数据在最后一个时间窗口内
    if (newTimestamp >= lastWindowStart && newTimestamp < lastWindowEnd) {
      // 将新数据添加到原始数据列表
      this.rawData.push(priceData);

      // 重新计算最后一个窗口的价格
      const pricesInWindow = this.rawData.filter(
        (p) => p.timestamp >= lastWindowStart && p.timestamp < lastWindowEnd
      );

      if (pricesInWindow.length > 0) {
        // 采用最接近时间窗口末端的数据
        const closestToEnd = pricesInWindow.reduce((latest, p) =>
          p.timestamp > latest.timestamp ? p : latest
        );
        this.alignedData[this.alignedData.length - 1] = {
          value: closestToEnd.value,
          timestamp: lastWindowStart,
        };
      }
      return;
    }

    // 情况2：数据在最后一个时间窗口后
    if (newTimestamp >= lastWindowEnd) {
      // 将新数据添加到原始数据列表
      this.rawData.push(priceData);

      // 计算新数据所在的时间窗口起始点
      const newTimePoint =
        Math.floor((newTimestamp - this.startTimestamp) / this.windowMs) * this.windowMs +
        this.startTimestamp;

      // 生成从最后一个时间窗口后到新时间点之间的所有时间窗口
      const newTimePoints: number[] = [];
      for (let t = lastWindowStart + this.windowMs; t <= newTimePoint; t += this.windowMs) {
        newTimePoints.push(t);
      }

      // 获取最后一个对齐数据的价格（用于沿用）
      let lastValue = this.alignedData[this.alignedData.length - 1].value;

      // 对每个新时间窗口进行聚合
      for (const timePoint of newTimePoints) {
        const windowStart = timePoint;
        const windowEnd = timePoint + this.windowMs;

        // 找到窗口内的所有数据点
        const pricesInWindow = this.rawData.filter(
          (p) => p.timestamp >= windowStart && p.timestamp < windowEnd
        );

        let aggregatedValue: number | null = null;

        if (pricesInWindow.length > 0) {
          // 窗口内有数据，采用最接近时间窗口末端的数据
          const closestToEnd = pricesInWindow.reduce((latest, p) =>
            p.timestamp > latest.timestamp ? p : latest
          );
          aggregatedValue = closestToEnd.value;
          lastValue = aggregatedValue;
        } else {
          // 窗口内没有数据，沿用上一个窗口的数据
          aggregatedValue = lastValue;
        }

        if (aggregatedValue !== null) {
          this.alignedData.push({
            value: aggregatedValue,
            timestamp: timePoint,
          });
        }
      }
      return;
    }

    // 其他情况：数据早于最后一个窗口，不添加数据
    // 不执行任何操作，数据不会被添加到 rawData
  }
}

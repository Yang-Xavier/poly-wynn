import { describe, it, expect } from "bun:test";
import { PriceAligner, PricePoint, AggregateAlignConfig } from "./aggregateAndAlign";

describe("PriceAligner", () => {
  describe("基本对齐功能", () => {
    it("应该正确对齐两个价格列表", () => {
      const pricesA: PricePoint[] = [
        { value: 100, timestamp: 1000 },
        { value: 101, timestamp: 1500 },
        { value: 102, timestamp: 2000 },
      ];
      const pricesB: PricePoint[] = [
        { value: 99, timestamp: 1100 },
        { value: 100, timestamp: 1600 },
        { value: 101, timestamp: 2100 },
      ];
      const config: AggregateAlignConfig = { windowMs: 1000 };

      const aligner = new PriceAligner(pricesA, pricesB, config);
      const alignedA = aligner.getAlignedPriceData("A");
      const alignedB = aligner.getAlignedPriceData("B");

      // 应该从相同的时间点开始
      expect(alignedA.length).toBeGreaterThan(0);
      expect(alignedB.length).toBeGreaterThan(0);
      expect(alignedA[0].timestamp).toBe(alignedB[0].timestamp);

      // 验证时间窗口一致
      if (alignedA.length > 1) {
        const timeDiff = alignedA[1].timestamp - alignedA[0].timestamp;
        expect(timeDiff).toBe(config.windowMs);
      }
    });

    it("应该使用最晚的起始时间作为对齐开始时间", () => {
      const pricesA: PricePoint[] = [{ value: 100, timestamp: 1000 }];
      const pricesB: PricePoint[] = [{ value: 99, timestamp: 1500 }];
      const config: AggregateAlignConfig = { windowMs: 1000 };

      const aligner = new PriceAligner(pricesA, pricesB, config);
      const alignedA = aligner.getAlignedPriceData("A");
      const alignedB = aligner.getAlignedPriceData("B");

      // 开始时间应该是 1500 向下取整到 1000
      expect(alignedA[0].timestamp).toBe(1000);
      expect(alignedB[0].timestamp).toBe(1000);
    });
  });

  describe("窗口内无数据时沿用上一个窗口期价格", () => {
    it("应该沿用上一个窗口期的价格", () => {
      const pricesA: PricePoint[] = [
        { value: 100, timestamp: 1000 }, // 窗口 1000-2000
        // 窗口 2000-3000 没有数据，应该沿用 100
        { value: 102, timestamp: 3500 }, // 窗口 3000-4000
      ];
      const pricesB: PricePoint[] = [
        { value: 99, timestamp: 1100 },
        { value: 101, timestamp: 3600 },
      ];
      const config: AggregateAlignConfig = { windowMs: 1000 };

      const aligner = new PriceAligner(pricesA, pricesB, config);
      const alignedA = aligner.getAlignedPriceData("A");

      // 找到时间戳为 2000 的点（第二个窗口期）
      const secondWindow = alignedA.find((p) => p.timestamp === 2000);
      expect(secondWindow).toBeDefined();
      if (secondWindow) {
        // 应该沿用第一个窗口期的价格 100
        expect(secondWindow.value).toBe(100);
      }

      // 第三个窗口期（3000）应该有新数据 102
      const thirdWindow = alignedA.find((p) => p.timestamp === 3000);
      expect(thirdWindow).toBeDefined();
      if (thirdWindow) {
        expect(thirdWindow.value).toBe(102);
      }
    });

    it("应该确保每个窗口期都有价格", () => {
      const pricesA: PricePoint[] = [
        { value: 100, timestamp: 1000 },
        { value: 102, timestamp: 4000 }, // 跳过了中间几个窗口
      ];
      const pricesB: PricePoint[] = [
        { value: 99, timestamp: 1100 },
        { value: 101, timestamp: 4100 },
      ];
      const config: AggregateAlignConfig = { windowMs: 1000 };

      const aligner = new PriceAligner(pricesA, pricesB, config);
      const alignedA = aligner.getAlignedPriceData("A");

      // 应该包含所有窗口期的数据
      const timestamps = alignedA.map((p) => p.timestamp);
      expect(timestamps).toContain(1000);
      expect(timestamps).toContain(2000);
      expect(timestamps).toContain(3000);
      expect(timestamps).toContain(4000);

      // 所有窗口期都应该有价格值
      alignedA.forEach((point) => {
        expect(point.value).toBeGreaterThan(0);
      });
    });
  });

  describe("两个列表长度可以不同", () => {
    it("应该允许两个列表有不同的长度", () => {
      const pricesA: PricePoint[] = [
        { value: 100, timestamp: 1000 },
        { value: 101, timestamp: 2000 },
        { value: 102, timestamp: 3000 },
      ];
      const pricesB: PricePoint[] = [
        { value: 99, timestamp: 1100 },
        { value: 100, timestamp: 2500 }, // 更少的数据点
      ];
      const config: AggregateAlignConfig = { windowMs: 1000 };

      const aligner = new PriceAligner(pricesA, pricesB, config);
      const alignedA = aligner.getAlignedPriceData("A");
      const alignedB = aligner.getAlignedPriceData("B");

      // 两个列表长度可以不同
      expect(alignedA.length).not.toBe(alignedB.length);
    });

    it("应该允许两个列表有不同的结束时间", () => {
      const pricesA: PricePoint[] = [
        { value: 100, timestamp: 1000 },
        { value: 101, timestamp: 2000 },
      ];
      const pricesB: PricePoint[] = [
        { value: 99, timestamp: 1100 },
        { value: 100, timestamp: 2500 },
        { value: 101, timestamp: 3500 }, // 更晚的结束时间
      ];
      const config: AggregateAlignConfig = { windowMs: 1000 };

      const aligner = new PriceAligner(pricesA, pricesB, config);
      const alignedA = aligner.getAlignedPriceData("A");
      const alignedB = aligner.getAlignedPriceData("B");

      // B 列表应该更长
      expect(alignedB.length).toBeGreaterThan(alignedA.length);

      // 两个列表的最后一个时间戳可以不同
      const lastA = alignedA[alignedA.length - 1];
      const lastB = alignedB[alignedB.length - 1];
      expect(lastB.timestamp).toBeGreaterThanOrEqual(lastA.timestamp);
    });
  });

  describe("增量更新功能", () => {
    it("应该支持添加新数据并更新对齐结果", () => {
      const pricesA: PricePoint[] = [{ value: 100, timestamp: 1000 }];
      const pricesB: PricePoint[] = [{ value: 99, timestamp: 1100 }];
      const config: AggregateAlignConfig = { windowMs: 1000 };

      const aligner = new PriceAligner(pricesA, pricesB, config);
      const alignedA1 = aligner.getAlignedPriceData("A");
      const initialLength = alignedA1.length;

      // 添加新数据
      aligner.addPriceData("A", { value: 101, timestamp: 2000 });
      const alignedA2 = aligner.getAlignedPriceData("A");

      // 应该增加了新的数据点
      expect(alignedA2.length).toBeGreaterThan(initialLength);

      // 应该包含新数据
      const newPoint = alignedA2.find((p) => p.timestamp === 2000);
      expect(newPoint).toBeDefined();
      if (newPoint) {
        expect(newPoint.value).toBe(101);
      }
    });

    it("应该正确更新已有窗口期的聚合值", () => {
      const pricesA: PricePoint[] = [
        { value: 100, timestamp: 1000 },
        { value: 101, timestamp: 1500 }, // 在同一个窗口内
      ];
      const pricesB: PricePoint[] = [{ value: 99, timestamp: 1100 }];
      const config: AggregateAlignConfig = { windowMs: 1000 };

      const aligner = new PriceAligner(pricesA, pricesB, config);
      const alignedA1 = aligner.getAlignedPriceData("A");

      // 找到第一个窗口期的值（应该是最新值 101）
      const firstWindow = alignedA1.find((p) => p.timestamp === 1000);
      expect(firstWindow).toBeDefined();
      if (firstWindow) {
        expect(firstWindow.value).toBe(101); // 使用最新值
      }

      // 添加更晚的数据到同一个窗口
      aligner.addPriceData("A", { value: 102, timestamp: 1800 });
      const alignedA2 = aligner.getAlignedPriceData("A");
      const updatedWindow = alignedA2.find((p) => p.timestamp === 1000);
      expect(updatedWindow).toBeDefined();
      if (updatedWindow) {
        expect(updatedWindow.value).toBe(102); // 应该更新为最新值
      }
    });

    it("应该正确处理扩展时间点序列", () => {
      const pricesA: PricePoint[] = [{ value: 100, timestamp: 1000 }];
      const pricesB: PricePoint[] = [{ value: 99, timestamp: 1100 }];
      const config: AggregateAlignConfig = { windowMs: 1000 };

      const aligner = new PriceAligner(pricesA, pricesB, config);
      const initialTimePoints = aligner.getTimePoints();
      const initialLength = initialTimePoints.length;

      // 添加一个超出当前范围的数据
      aligner.addPriceData("A", { value: 105, timestamp: 5000 });
      const alignedA = aligner.getAlignedPriceData("A");
      const timePoints = aligner.getTimePoints();

      // 应该包含新的时间点
      const newPoint = alignedA.find((p) => p.timestamp === 5000);
      expect(newPoint).toBeDefined();
      if (newPoint) {
        expect(newPoint.value).toBe(105);
      }

      // 时间点序列应该扩展了（因为 endTimeA 更新为 5000）
      // 注意：timePoints 包含所有可能的时间点，但 alignedA 只包含到 endTimeA
      expect(timePoints.length).toBeGreaterThanOrEqual(initialLength);

      // 验证 alignedA 应该包含从开始时间到 5000 之间的所有窗口期
      // 由于 endTimeA 更新为 5000，应该包含中间窗口
      const timestamps = alignedA.map((p) => p.timestamp);
      // 至少应该包含开始时间点和结束时间点
      expect(timestamps.length).toBeGreaterThan(1);
      // 验证所有窗口期都有价格（沿用机制）
      alignedA.forEach((point) => {
        expect(point.value).toBeGreaterThan(0);
      });

      // 验证最后一个时间点应该是 5000（向下取整到窗口边界）
      const lastTimestamp = timestamps[timestamps.length - 1];
      expect(lastTimestamp).toBe(5000);
    });
  });

  describe("边界情况", () => {
    it("应该处理空列表", () => {
      const pricesA: PricePoint[] = [];
      const pricesB: PricePoint[] = [];
      const config: AggregateAlignConfig = { windowMs: 1000 };

      const aligner = new PriceAligner(pricesA, pricesB, config);
      const alignedA = aligner.getAlignedPriceData("A");
      const alignedB = aligner.getAlignedPriceData("B");

      expect(alignedA).toEqual([]);
      expect(alignedB).toEqual([]);
    });

    it("应该处理只有一个数据点的情况", () => {
      const pricesA: PricePoint[] = [{ value: 100, timestamp: 1000 }];
      const pricesB: PricePoint[] = [{ value: 99, timestamp: 1100 }];
      const config: AggregateAlignConfig = { windowMs: 1000 };

      const aligner = new PriceAligner(pricesA, pricesB, config);
      const alignedA = aligner.getAlignedPriceData("A");
      const alignedB = aligner.getAlignedPriceData("B");

      expect(alignedA.length).toBeGreaterThan(0);
      expect(alignedB.length).toBeGreaterThan(0);
      expect(alignedA[0].value).toBe(100);
      expect(alignedB[0].value).toBe(99);
    });

    it("应该验证时间窗口必须大于0", () => {
      const pricesA: PricePoint[] = [{ value: 100, timestamp: 1000 }];
      const pricesB: PricePoint[] = [{ value: 99, timestamp: 1100 }];
      const config: AggregateAlignConfig = { windowMs: 0 };

      expect(() => {
        new PriceAligner(pricesA, pricesB, config);
      }).toThrow("时间窗口必须大于0");
    });

    it("应该处理时间戳早于开始时间的新数据", () => {
      const pricesA: PricePoint[] = [{ value: 100, timestamp: 2000 }];
      const pricesB: PricePoint[] = [{ value: 99, timestamp: 2100 }];
      const config: AggregateAlignConfig = { windowMs: 1000 };

      const aligner = new PriceAligner(pricesA, pricesB, config);
      const initialStartTime = aligner.getTimePoints()[0];

      // 添加一个早于开始时间的数据
      aligner.addPriceData("A", { value: 95, timestamp: 1000 });
      const alignedA = aligner.getAlignedPriceData("A");
      const newStartTime = aligner.getTimePoints()[0];

      // 应该重新计算，开始时间应该更新（使用最晚的起始时间）
      expect(alignedA.length).toBeGreaterThan(0);
      // 开始时间应该是对齐后的（使用最晚的起始时间，向下取整到窗口边界）
      // 由于 B 的最早时间是 2100，开始时间应该是 2000
      // 但添加了 A 的 1000 后，开始时间应该变为 1000（最晚的起始时间是 1000，向下取整到 1000）
      expect(newStartTime).toBeLessThanOrEqual(initialStartTime);
    });
  });

  describe("聚合策略", () => {
    it("应该使用窗口内的最新值", () => {
      const pricesA: PricePoint[] = [
        { value: 100, timestamp: 1000 },
        { value: 101, timestamp: 1500 }, // 同一个窗口内的更晚数据
        { value: 102, timestamp: 1800 }, // 同一个窗口内的更晚数据
      ];
      const pricesB: PricePoint[] = [{ value: 99, timestamp: 1100 }];
      const config: AggregateAlignConfig = { windowMs: 1000 };

      const aligner = new PriceAligner(pricesA, pricesB, config);
      const alignedA = aligner.getAlignedPriceData("A");

      // 第一个窗口期应该使用最新值 102
      const firstWindow = alignedA.find((p) => p.timestamp === 1000);
      expect(firstWindow).toBeDefined();
      if (firstWindow) {
        expect(firstWindow.value).toBe(102);
      }
    });
  });

  describe("辅助方法", () => {
    it("应该正确返回时间点序列", () => {
      const pricesA: PricePoint[] = [
        { value: 100, timestamp: 1000 },
        { value: 101, timestamp: 2000 },
      ];
      const pricesB: PricePoint[] = [
        { value: 99, timestamp: 1100 },
        { value: 100, timestamp: 2500 },
      ];
      const config: AggregateAlignConfig = { windowMs: 1000 };

      const aligner = new PriceAligner(pricesA, pricesB, config);
      const timePoints = aligner.getTimePoints();

      expect(timePoints.length).toBeGreaterThan(0);
      // 时间点应该是递增的
      for (let i = 1; i < timePoints.length; i++) {
        expect(timePoints[i]).toBeGreaterThan(timePoints[i - 1]);
      }
    });

    it("应该正确返回原始价格数据", () => {
      const pricesA: PricePoint[] = [
        { value: 100, timestamp: 1000 },
        { value: 101, timestamp: 2000 },
      ];
      const pricesB: PricePoint[] = [{ value: 99, timestamp: 1100 }];
      const config: AggregateAlignConfig = { windowMs: 1000 };

      const aligner = new PriceAligner(pricesA, pricesB, config);
      const rawA = aligner.getRawPriceData("A");
      const rawB = aligner.getRawPriceData("B");

      expect(rawA).toEqual(pricesA);
      expect(rawB).toEqual(pricesB);
    });

    it("应该正确返回完整的对齐结果", () => {
      const pricesA: PricePoint[] = [{ value: 100, timestamp: 1000 }];
      const pricesB: PricePoint[] = [{ value: 99, timestamp: 1100 }];
      const config: AggregateAlignConfig = { windowMs: 1000 };

      const aligner = new PriceAligner(pricesA, pricesB, config);
      const result = aligner.getAlignedResult();

      expect(result).toHaveProperty("alignedA");
      expect(result).toHaveProperty("alignedB");
      expect(result).toHaveProperty("timePoints");
      expect(Array.isArray(result.alignedA)).toBe(true);
      expect(Array.isArray(result.alignedB)).toBe(true);
      expect(Array.isArray(result.timePoints)).toBe(true);
    });
  });
});

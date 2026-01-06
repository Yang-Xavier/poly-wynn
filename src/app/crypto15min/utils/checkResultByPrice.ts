import { PriceData } from "@shared/ws/PolyPriceWs";
import { OUTCOMES_ENUM } from "@shared/constants";
import { waitFor } from "@shared/utils/waitFor";

export const checkResultByPrice = async (
  targetPrice: number,
  historyPrices: PriceData[],
  slugIntervalTimestamp: number
) => {
  // 15分钟后的区间结束时间（秒 -> 毫秒）
  const intervalMs = 15 * 60 * 1000;
  const endTimestampMs = slugIntervalTimestamp * 1000 + intervalMs + 3 * 1000; // 加 3s buffer

  const now = Date.now();
  if (now < endTimestampMs) {
    await waitFor(endTimestampMs - now);
  }

  // 找出所有 <= endTimestampMs 的价格
  let closest: PriceData | null = null;
  let minDiff = Number.MAX_SAFE_INTEGER;
  for (const price of historyPrices) {
    if (price.timestamp <= endTimestampMs) {
      const diff = endTimestampMs - price.timestamp;
      if (diff < minDiff) {
        minDiff = diff;
        closest = price;
      }
    }
  }

  if (!closest) return undefined;

  // 对比 targetPrice

  return {
    finalOutcome:
      Number(closest.value) >= Number(targetPrice) ? OUTCOMES_ENUM.Up : OUTCOMES_ENUM.Down,
    finalPrice: Number(closest.value),
  };
};

import gammaApi from "@shared/api/gammaApi";
import { logError } from "../logger";
import polymarketApi from "@shared/api/polymarketApi";
import { waitFor } from "@shared/utils/waitFor";
import { distanceToNextInterval } from "@shared/utils/market";

export const getPriceToBeat = async (
  symbol: string,
  eventStartTime: string,
  endDate: string,
  slugIntervalTimestamp
) => {
  while (distanceToNextInterval(slugIntervalTimestamp) > 0) {
    try {
      return await polymarketApi.getPriceToBeat(symbol, eventStartTime, endDate);
    } catch (error) {
      logError(
        `${JSON.stringify({ symbol, eventStartTime, endDate })}, 获取对赌价格失败: ${error}`
      );
      await waitFor(1000);
    }
  }
};

export const getMarketBySlug = async (slug: string, slugIntervalTimestamp: number) => {
  while (distanceToNextInterval(slugIntervalTimestamp) > 0) {
    try {
      const data = await gammaApi.getMarketBySlug(slug);
      if (data) {
        return data;
      }
    } catch (error) {
      logError(`获取市场信息失败: ${error}`);
    }
    await waitFor(1000);
  }
  return await gammaApi.getMarketBySlug(slug);
};

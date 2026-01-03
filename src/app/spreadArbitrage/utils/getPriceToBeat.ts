import { logError } from "../logger";
import polymarketApi from "@shared/api/polymarketApi";
import { waitFor } from "@shared/utils/waitFor";

export const getPriceToBeat = async (symbol: string, eventStartTime: string, endDate: string) => {
  while (1) {
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

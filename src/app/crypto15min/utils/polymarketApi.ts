import { getGlobalConfig } from "./config";
import Proxy from "@shared/Proxy";
import { awaitAxiosDataTo } from "./awaitTo";
import { logError } from "@crypto15min/module/logger";
import { waitFor } from "./tools";

export const getPriceToBeat = async (symbol: string, eventStartTime: string, endDate: string) => {
  const url = `${getGlobalConfig().polymarketHost}/api/crypto/crypto-price?symbol=${symbol}&eventStartTime=${eventStartTime}&variant=fifteen&endDate=${endDate}`;
  while (1) {
    const [error, response] = await awaitAxiosDataTo(Proxy.get(url));
    if (response && response?.openPrice) {
      return response?.openPrice;
    } else {
      logError(
        `${JSON.stringify({ symbol, eventStartTime, endDate })}, 获取对赌价格失败: ${error}`
      );
    }
    await waitFor(1000);
  }
};

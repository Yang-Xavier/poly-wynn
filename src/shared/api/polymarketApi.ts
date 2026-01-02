import { getGlobalConfig } from "../config";
import Proxy from "@shared/Proxy";
import { awaitAxiosDataTo } from "@shared/utils/awaitTo";
import { waitFor } from "@shared/utils/waitFor";

export const getPriceToBeat = async (symbol: string, eventStartTime: string, endDate: string) => {
  const url = `${getGlobalConfig().polymarketHost}/api/crypto/crypto-price?symbol=${symbol}&eventStartTime=${eventStartTime}&variant=fifteen&endDate=${endDate}`;
  while (1) {
    const [error, response] = await awaitAxiosDataTo(Proxy.get(url));
    if (response && response?.openPrice) {
      return response?.openPrice;
    } else {
      console.log(
        `${JSON.stringify({ symbol, eventStartTime, endDate })}, 获取对赌价格失败: ${error}`
      );
    }

    console.log(`[PolymarketApi] 获取对赌价格失败,等待1秒后重试`);
    await waitFor(1000);
  }
};

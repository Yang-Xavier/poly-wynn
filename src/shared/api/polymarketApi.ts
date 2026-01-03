import { POLYMARKET_HOST } from "@shared/constants";
import Proxy from "@shared/Proxy";
import { awaitAxiosDataTo } from "@shared/utils/awaitTo";

export default {
  getPriceToBeat: async (symbol: string, eventStartTime: string, endDate: string) => {
    const url = `${POLYMARKET_HOST}/api/crypto/crypto-price?symbol=${symbol}&eventStartTime=${eventStartTime}&variant=fifteen&endDate=${endDate}`;
    const [error, response] = await awaitAxiosDataTo(Proxy.get(url));
    if (response && response?.openPrice) {
      return response?.openPrice;
    }
    throw error;
  },
};

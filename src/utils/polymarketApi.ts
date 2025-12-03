import { getGlobalConfig } from "./config";
import Proxy from "./Proxy";
import { awaitAxiosDataTo } from "./awaitTo";
import { logError } from "src/module/logger";
import { waitFor } from "./tools";

export const getPriceToBeat = async (symbol: string, eventStartTime: string, endDate: string) => {
    const url = `${getGlobalConfig().polymarketHost}/api/crypto/crypto-price?symbol=${symbol}&eventStartTime=${eventStartTime}&variant=fifteen&endDate=${endDate}`;
    while (true) {
        const [error, response] = await awaitAxiosDataTo(Proxy.get(url));
        if (response && response?.openPrice) {
            return response?.openPrice;
        } else {
            logError(`[PolymarketApi] Failed to get price to beat: ${error}`);
        }
        await waitFor(1000);
    }

}

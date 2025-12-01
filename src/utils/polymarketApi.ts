import axios from "axios";
import { getGlobalConfig } from "./config";
import Proxy from "./Proxy";
import { awaitAxiosDataTo } from "./awaitTo";

export const getPriceToBeat = async (symbol: string, eventStartTime: string) => {
    const [_, response] = await awaitAxiosDataTo(Proxy.get(`${getGlobalConfig().polymarketHost}/api/crypto/crypto-price?symbol=${symbol}&eventStartTime=${eventStartTime}`));
    return response.openPrice;
}
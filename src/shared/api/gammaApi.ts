import { getGlobalConfig } from "@shared/config";
import proxy from "@shared/Proxy";
import { awaitAxiosDataTo } from "@shared/utils/awaitTo";
import { TMarketResponseData } from "@typings/gammaData";

const GammaApiHost = getGlobalConfig().gammaHost;

export default {
  /**
   * 通过 slug 获取 market 信息
   * @param slug market 的唯一标识符
   * @returns Market 响应数据
   */
  getMarketBySlug: async (slug: string): Promise<TMarketResponseData | null> => {
    const url = `${GammaApiHost}/markets/slug/${slug}`;
    const [error, data] = await awaitAxiosDataTo(proxy.get(url));
    if (error) {
      return null;
    }

    return data as TMarketResponseData;
  },
};

import { GAMMA_HOST } from "@shared/constants";
import proxy from "@shared/Proxy";
import { awaitAxiosDataTo } from "@shared/utils/awaitTo";
import { TMarketResponseData, TEventResponseData } from "@typings/gammaData";

export default {
  /**
   * 通过 slug 获取 market 信息
   * @param slug market 的唯一标识符
   * @returns Market 响应数据
   */
  getMarketBySlug: async (slug: string): Promise<TMarketResponseData | null> => {
    const url = `${GAMMA_HOST}/markets/slug/${slug}`;
    const [error, data] = await awaitAxiosDataTo(proxy.get(url));
    if (error) {
      throw error;
    }

    return data as TMarketResponseData;
  },

  /**
   * 通过 slug 获取 event 信息
   * @param slug event 的唯一标识符
   * @param options 可选参数，包括 include_chat 和 include_template
   * @returns Event 响应数据
   */
  getEventBySlug: async (
    slug: string,
    options?: { include_chat?: boolean; include_template?: boolean }
  ): Promise<TEventResponseData | null> => {
    let url = `${GAMMA_HOST}/events/slug/${slug}`;
    const params: string[] = [];
    
    if (options?.include_chat !== undefined) {
      params.push(`include_chat=${options.include_chat}`);
    }
    if (options?.include_template !== undefined) {
      params.push(`include_template=${options.include_template}`);
    }
    
    if (params.length > 0) {
      url += `?${params.join("&")}`;
    }
    
    const [error, data] = await awaitAxiosDataTo(proxy.get(url));
    if (error) {
      throw error;
    }

    return data as TEventResponseData;
  },
  
};

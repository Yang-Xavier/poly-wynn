import { GAMMA_HOST } from "@shared/constants";
import proxy from "@shared/Proxy";
import { awaitAxiosDataTo } from "@shared/utils/awaitTo";
import { TMarketResponseData } from "@typings/gammaData";

export interface GetPositionsParams {
  user: string; // 必需：用户地址
  market?: string[]; // 可选的 condition IDs 列表
  eventId?: number[]; // 可选的 event IDs 列表
  sizeThreshold?: number; // 默认 1
  redeemable?: boolean; // 默认 false
  mergeable?: boolean; // 默认 false
  limit?: number; // 默认 100，范围 0-500
  offset?: number; // 默认 0，范围 0-10000
  sortBy?:
    | "CURRENT"
    | "INITIAL"
    | "TOKENS"
    | "CASHPNL"
    | "PERCENTPNL"
    | "TITLE"
    | "RESOLVING"
    | "PRICE"
    | "AVGPRICE"; // 默认 TOKENS
  sortDirection?: "ASC" | "DESC"; // 默认 DESC
  title?: string; // 最大长度 100
}
export interface Position {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  totalBought: number;
  realizedPnl: number;
  percentRealizedPnl: number;
  curPrice: number;
  redeemable: boolean;
  mergeable: boolean;
  title: string;
  slug: string;
  icon: string;
  eventSlug: string;
  outcome: string;
  outcomeIndex: number;
  oppositeOutcome: string;
  oppositeAsset: string;
  endDate: string;
  negativeRisk: boolean;
}

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
      return null;
    }

    return data as TMarketResponseData;
  },
  /**
   * 获取用户当前仓位
   * @param params 查询参数
   * @returns 仓位数组
   */
  getPositions: async (params: GetPositionsParams): Promise<Position[]> => {
    const url = `${GAMMA_HOST}/positions`;
    // 构建查询参数
    const queryParams: any = {
      user: params.user,
    };

    if (params.market && params.market.length > 0) {
      queryParams.market = params.market.join(",");
    }

    if (params.eventId && params.eventId.length > 0) {
      queryParams.eventId = params.eventId.join(",");
    }

    if (params.sizeThreshold !== undefined) {
      queryParams.sizeThreshold = params.sizeThreshold;
    }

    if (params.redeemable !== undefined) {
      queryParams.redeemable = params.redeemable;
    }

    if (params.mergeable !== undefined) {
      queryParams.mergeable = params.mergeable;
    }

    if (params.limit !== undefined) {
      queryParams.limit = params.limit;
    }

    if (params.offset !== undefined) {
      queryParams.offset = params.offset;
    }

    if (params.sortBy) {
      queryParams.sortBy = params.sortBy;
    }

    if (params.sortDirection) {
      queryParams.sortDirection = params.sortDirection;
    }

    if (params.title) {
      queryParams.title = params.title;
    }

    const [error, data] = await awaitAxiosDataTo(proxy.get(url, { params: queryParams }));
    if (error) {
      console.error("获取仓位失败:", error);
      throw error;
    }

    return data as Position[];
  },
};

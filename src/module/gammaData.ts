import { awaitAxiosDataTo } from '../utils/awaitTo';
import proxy from '@utils/Proxy';
import { logInfo } from '../module/logger';
import { getGlobalConfig } from '@utils/config';
import { OpenOrdersResponse } from '@polymarket/clob-client';
import { PolymarketOrderResult } from './clob';




// Market 响应类型
interface MarketResponse {
    id: string;
    slug: string;
    question: string;
    clobTokenIds: string;
    [key: string]: any;
}

// Position 响应类型
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

export interface GetPositionsParams {
    user: string; // 必需：用户地址
    market?: string[]; // 可选的 condition IDs 列表
    eventId?: number[]; // 可选的 event IDs 列表
    sizeThreshold?: number; // 默认 1
    redeemable?: boolean; // 默认 false
    mergeable?: boolean; // 默认 false
    limit?: number; // 默认 100，范围 0-500
    offset?: number; // 默认 0，范围 0-10000
    sortBy?: 'CURRENT' | 'INITIAL' | 'TOKENS' | 'CASHPNL' | 'PERCENTPNL' | 'TITLE' | 'RESOLVING' | 'PRICE' | 'AVGPRICE'; // 默认 TOKENS
    sortDirection?: 'ASC' | 'DESC'; // 默认 DESC
    title?: string; // 最大长度 100
}

/**
 * GammaData 单例类
 * 提供 Gamma API 相关的所有功能
 */
class GammaData {
    private static instance: GammaData | null = null;
    private gammaApiHost: string = '';
    private dataApiHost: string = '';

    /**
     * 私有构造函数，确保单例模式
     */
    private constructor() {
        const globalConfig = getGlobalConfig();
        this.gammaApiHost = globalConfig.gammaHost;
        this.dataApiHost = globalConfig.dataHost;
    }

    /**
     * 获取 GammaData 单例实例
     * @returns GammaData 单例实例
     */
    public static getInstance(): GammaData {
        if (!GammaData.instance) {
            GammaData.instance = new GammaData();
        }
        return GammaData.instance;
    }

    /**
     * 通过 slug 获取 market 信息
     * @param slug market 的唯一标识符
     * @returns Market 响应数据
     */
    public async getMarketBySlug(slug: string): Promise<MarketResponse | null> {
        const url = `${this.gammaApiHost}/markets/slug/${slug}`;
        const [error, data] = await awaitAxiosDataTo(proxy.get(url));
        if (error) {
            return null;
        }

        return data as MarketResponse;
    }

    /**
     * 通过 slug 获取 market 的 clobTokenIds
     * @param market Market 响应数据
     * @returns clobTokenIds 数组
     */
    public getClobTokensBySlug(market: MarketResponse): { id: string, outcome: string }[] {
        const clobTokenIds = JSON.parse(market.clobTokenIds) as string[] || [];
        const outcomes = JSON.parse(market.outcomes) as string[] || [];
        return [
            {
                id: clobTokenIds[0],
                outcome: outcomes[0]
            },
            {
                id: clobTokenIds[1],
                outcome: outcomes[1]
            }
        ]
    }

    /**
     * 获取用户当前仓位
     * @param params 查询参数
     * @returns 仓位数组
     */
    public async getCurrentPositions(params: GetPositionsParams): Promise<Position[]> {
        const url = `${this.dataApiHost}/positions`;

        // 构建查询参数
        const queryParams: any = {
            user: params.user,
        };

        if (params.market && params.market.length > 0) {
            queryParams.market = params.market.join(',');
        }

        if (params.eventId && params.eventId.length > 0) {
            queryParams.eventId = params.eventId.join(',');
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
            console.error('获取仓位失败:', error);
            throw error;
        }

        return data as Position[];
    }

    public async getUserpostionByMarketAsOrder(market: string, user: string): Promise<PolymarketOrderResult[]> {
        const positions = await this.getCurrentPositions({ user: user, market: [market], limit: 1000 });

        return positions.map(position => {
            return {
                id: "",
                status: 'MATCHED',
                owner: position.proxyWallet,
                maker_address: position.proxyWallet,
                market: position.conditionId,
                asset_id: position.asset,
                side: "",
                original_size: position.size.toString(),
                size_matched: position.size.toString(),
                price: position.avgPrice.toString(),
                outcome: position.outcome,
                expiration: "",
                order_type: "",
                associate_trades: [],
                created_at: 0,
            }
        });
    }

    /**
     * 获取可赎回的仓位
     * @param params 查询参数
     * @returns 可赎回的仓位数组
     */
    public async getRedeemablePositions(params: { funderAddress: string }): Promise<Position[]> {
        const positions = await this.getCurrentPositions({ user: params.funderAddress, redeemable: true, limit: 1000 });
        return positions.filter(position => position.redeemable && position.percentRealizedPnl > 0);
    }
}

// 导出单例实例的便捷访问方法
export const getGammaDataModule = () => GammaData.getInstance();

// 导出类型
export type { MarketResponse };

// {
//     proxyWallet: '0xe10c61be54e4c25fb744113cbbaff28123f5a107',
//     asset: '105956926795341786132705470235837036019524920190622067996232823971885602696842',
//     conditionId: '0xf1e3c19dfa2c522df8776096a79f0fb9a7dfef52402c696f6db04bda9cfcefbf',
//     size: 2.777776,
//     avgPrice: 0.719999,
//     initialValue: 1.999995942224,
//     currentValue: 2.777776,
//     cashPnl: 0.7777800577760001,
//     percentPnl: 38.88908179039138,
//     totalBought: 2.777776,
//     realizedPnl: 0,
//     percentRealizedPnl: 38.88908179039137,
//     curPrice: 1,
//     redeemable: true,
//     mergeable: false,
//     title: 'Bitcoin Up or Down - November 28, 3:00AM-3:15AM ET',
//     slug: 'btc-updown-15m-1764316800',
//     icon: 'https://polymarket-upload.s3.us-east-2.amazonaws.com/BTC+fullsize.png',
//     eventId: '91525',
//     eventSlug: 'btc-updown-15m-1764316800',
//     outcome: 'Up',
//     outcomeIndex: 0,
//     oppositeOutcome: 'Down',
//     oppositeAsset: '23567562027407898821714802825544198270429785990248047196272364218395590339880',
//     endDate: '2025-11-28',
//     negativeRisk: false
//   }

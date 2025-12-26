/**
 * Polymarket CLOB WebSocket 市场数据连接类
 * 用于连接 Polymarket 的 CLOB WebSocket 服务，订阅市场实时价格变化并缓存
 */

import type WebSocket from 'ws';
import { getGlobalConfig } from '@utils/config';
import { getClobModule } from 'src/module/clob';
import { logData, logInfo } from 'src/module/logger';
import { BaseLiveDataClient } from 'src/module/BaseLiveDataClient';
import { pick } from './tools';

// 订阅请求接口
interface MarketSubscriptionRequest {
    assets_ids: string[];
    type: 'market';
}

// 推送数据接口
export interface MarketPushData {
    market: string;
    asset_id: string;
    bids: {
        price: string;
        size: string;
    }[];
    asks: {
        price: string;
        size: string;
    }[];
    event_type: 'book';
    hash: string;
    timestamp: string;
}


/**
 * Polymarket CLOB WebSocket 市场数据客户端
 * 继承基础 WebSocket 客户端，仅实现自身的消息处理和订阅逻辑
 */
class PolyMarketDataClient extends BaseLiveDataClient {
    // 订阅的资产ID列表
    private subscribedAssetIds: string[] = [];

    constructor() {
        const globalConfig = getGlobalConfig();
        super({
            url: globalConfig.ws.marketDataUrl,
            name: 'PolyMarketData',
            maxCacheSize: globalConfig.ws.maxCacheSize,
        });
    }

    /**
     * 连接成功时的回调：重新订阅之前的 assetId
     */
    protected onOpen(): void {
        if (this.subscribedAssetIds.length > 0) {
            this.subscribeMarket(this.subscribedAssetIds);
        }
    }

    /**
     * 处理接收到的消息
     */
    protected onMessage(data: WebSocket.Data): void {
        try {
            if(data.toString().toLowerCase() === 'pong') {
                return;
            }
            const message = JSON.parse(data.toString()) as MarketPushData;
            
            if(message.event_type === 'book') {
                const { asset_id, asks, bids } = message;
                // 使用基础类统一的缓存策略，key 为 asset_id
                this.cacheItem(asset_id, message);
                this.invokeCallback('watchOrderBookPriceChange', message);
                logData(`[PolyMarketData] asset_id: ${asset_id}, bestAsks: ${asks?.length > 0 ? asks[asks.length-1].price : 'N/A'}, bestBids: ${bids?.length > 0 ? bids[bids.length-1].price : 'N/A'}`);
            }
        } catch (error) {
            logInfo(`[PolyMarketData] 解析消息失败: ${error} data: ${data.toString()}`);
        }
    }
    
    /**
     * 发送订阅请求
     */
    private sendSubscription(subscription: MarketSubscriptionRequest): void {
        if (!this.ws || this.ws.readyState !== 1) {
            logInfo('[PolyMarketData] WebSocket 未连接，无法发送订阅');
            return;
        }
        
        const message = JSON.stringify(subscription);
        this.ws.send(message);
        logInfo('[PolyMarketData] 发送订阅请求:', message);
    }
    
    /**
     * 订阅市场数据
     * @param assetIds 资产ID数组
     */
    subscribeMarket(assetIds: string[]): void {
        if (!Array.isArray(assetIds) || assetIds.length === 0) {
            logInfo('[PolyMarketData] 资产ID列表为空，无法订阅');
            return;
        }
        
        // 更新订阅的资产ID列表（去重）
        const uniqueAssetIds = Array.from(new Set(assetIds));
        this.subscribedAssetIds = uniqueAssetIds;
        
        const subscription: MarketSubscriptionRequest = {
            assets_ids: uniqueAssetIds,
            type: 'market'
        };
        
        if (this.isConnected && this.ws?.readyState === 1) {
            this.sendSubscription(subscription);
        } else {
            logInfo('[PolyMarketData] WebSocket 未连接，订阅将在连接建立后自动发送');
        }
    }
    
    /**
     * 添加资产ID到订阅列表（追加订阅）
     * @param assetIds 要添加的资产ID数组
     */
    addSubscription(assetIds: string[]): void {
        const newAssetIds = Array.from(new Set([...this.subscribedAssetIds, ...assetIds]));
        this.subscribeMarket(newAssetIds);
    }
    
    /**
     * 获取所有缓存数据
     * @returns 缓存数据数组
     */
    getCache(): MarketPushData[] {
        const keys = this.getAllCacheKeys();
        return keys.flatMap((assetId) => this.getCachedList<MarketPushData>(assetId));
    }
    
    /**
     * 清空缓存
     */
    clearCache(): void {
        this.clearAllCache();
    }

    /**
     * 获取当前订阅的资产ID列表
     * @returns 资产ID数组
     */
    getSubscribedAssetIds(): string[] {
        return [...this.subscribedAssetIds];
    }

    /**
     * 断开连接时子类的清理逻辑
     */
    protected onDisconnectCleanup(): void {
        this.clearCache();
        this.subscribedAssetIds = [];
    }

    onWatchOrderBookPriceChange(callback: (data: MarketPushData) => void) {
        this.setCallback('watchOrderBookPriceChange', callback);
    }

    async getLatestPriceChangeByAssetId(assetId: string): Promise<MarketPushData | null> {
        const latest = this.getLatestCached<MarketPushData>(assetId);
        if (!latest) {
            logInfo(`[PolyMarketData] No data found in cache for assetId: ${assetId}, getting from clob...`);
            const data = await getClobModule().getOrderBookSummary(assetId);
            return pick(data, ['bids', 'asks', 'market', 'asset_id', 'timestamp']) as any as MarketPushData;
        }
        return latest;
    }

    getBestAskByAssetId(assetId: string): number | null {
        const orderbookSummary = this.getLatestCached<MarketPushData>(assetId);
        if (!orderbookSummary || !orderbookSummary.asks || orderbookSummary.asks.length === 0) {
            return null;
        }
        return Number(orderbookSummary.asks[orderbookSummary.asks.length - 1]?.price);
    }
}

export const polyMarketDataClient = new PolyMarketDataClient();


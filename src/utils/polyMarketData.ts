/**
 * Polymarket CLOB WebSocket 市场数据连接类
 * 用于连接 Polymarket 的 CLOB WebSocket 服务，订阅市场实时价格变化并缓存
 */

import { getGlobalConfig } from '@utils/config';
import { getClobModule } from 'src/module/clob';
import { logData, logError, logInfo } from 'src/module/logger';
import WebSocket from 'ws';
import { pick } from './tools';

// 订阅请求接口
interface MarketSubscriptionRequest {
    assets_ids: string[];
    type: 'market';
}

// 推送数据接口
interface MarketPushData {
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


// 缓存数据项接口
interface CachedData {
    data: MarketPushData;
    cachedAt: number;
}

/**
 * Polymarket CLOB WebSocket 市场数据客户端
 */
class PolyMarketDataClient {
    private ws: WebSocket | null = null;
    private url: string;
    private isConnected: boolean = false;
    private isManualDisconnect: boolean = false; // 标记是否是主动断开
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5;
    private reconnectDelay: number = 3000; // 3秒
    
    // 数据缓存：使用数组存储所有接收到的数据
    private cache: Map<string, CachedData[]> = new Map();
    private maxCacheSize: number = 1000; // 最大缓存数量

    private onWatchOrderBookPriceChangeCb: (data: MarketPushData) => void = () => {};

    // 订阅的资产ID列表
    private subscribedAssetIds: string[] = [];
    

    constructor() {
        const globalConfig = getGlobalConfig();
        this.url = globalConfig.ws.marketDataUrl;
        this.maxCacheSize = globalConfig.ws.maxCacheSize;
    }
    
    /**
     * 建立 WebSocket 连接
     * @returns Promise<void>
     */
    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
                resolve();
                return;
            }
            
            try {
                this.ws = new WebSocket(this.url);
                
                this.ws.on('open', () => {
                    logInfo('[PolyMarketData] WebSocket 连接已建立');
                    this.isConnected = true;
                    this.isManualDisconnect = false; // 重置主动断开标志
                    this.reconnectAttempts = 0;
                    
                    // 连接成功后，重新订阅之前的订阅
                    if (this.subscribedAssetIds.length > 0) {
                        this.subscribeMarket(this.subscribedAssetIds);
                    }
                    
                    resolve();
                });
                
                this.ws.on('message', (data: WebSocket.Data) => {
                    this.handleMessage(data);
                });
                
                this.ws.on('error', (error: Error) => {
                    logInfo('[PolyMarketData] WebSocket 错误:', error);
                    this.isConnected = false;
                    if (this.reconnectAttempts === 0) {
                        reject(error);
                    }
                });

                this.ws.on('close', (code: number, reason: Buffer) => {
                    logInfo(`[PolyMarketData] WebSocket 连接已关闭: ${code} - ${reason.toString()}`);
                    this.isConnected = false;
                    this.ws = null;
                    
                    // 只有在非主动断开的情况下才尝试重连
                    if (!this.isManualDisconnect) {
                        this.attemptReconnect();
                    } else {
                        logInfo('[PolyMarketData] 主动断开连接，不进行重连');
                    }
                });
                
            } catch (error) {
                logError(`[PolyMarketData] 连接失败: ${error}`);
                reject(error);
            }
        });
    }
    


    /**
     * 处理接收到的消息
     */
    private handleMessage(data: WebSocket.Data): void {
        try {
            if(data.toString().toLowerCase() === 'pong') {
                return;
            }
            const message = JSON.parse(data.toString()) as MarketPushData;
            
            if(message.event_type === 'book') {
                const { asset_id, asks, bids } = message;
                this.cacheData(message);
                this.onWatchOrderBookPriceChangeCb?.(message);
                logData(`[PolyMarketData] asset_id: ${asset_id}, bestAsks: ${asks?.length > 0 ? asks[asks.length-1].price : 'N/A'}, bestBids: ${bids?.length > 0 ? bids[bids.length-1].price : 'N/A'}`);
            }
        } catch (error) {
            logInfo(`[PolyMarketData] 解析消息失败: ${error} data: ${data.toString()}`);
        }
    }
    
    /**
     * 缓存数据
     */
    private cacheData(data: MarketPushData): void {
        if (!this.cache.has(data.asset_id)) {
            this.cache.set(data.asset_id, []);
        }
        const cache = this.cache.get(data.asset_id)!;
        cache.push({
            data,
            cachedAt: Date.now()
        });
        if (cache.length > this.maxCacheSize) {
            cache.shift();
        }
    }
    
    /**
     * 发送订阅请求
     */
    private sendSubscription(subscription: MarketSubscriptionRequest): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            logInfo('[PolyMarketData] WebSocket 未连接，无法发送订阅');
            return;
        }
        
        const message = JSON.stringify(subscription);
        this.ws.send(message);
        logInfo('[PolyMarketData] 发送订阅请求:', message);
    }
    
    /**
     * 尝试重连
     */
    private attemptReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logInfo('[PolyMarketData] 达到最大重连次数，停止重连');
            return;
        }
        
        this.reconnectAttempts++;
        logInfo(`[PolyMarketData] ${this.reconnectDelay / 1000}秒后尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        
        setTimeout(() => {
            this.connect().catch((error) => {
                logInfo('[PolyMarketData] 重连失败:', error);
            });
        }, this.reconnectDelay);
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
        
        if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
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
        return Array.from(this.cache.values()).flatMap(item => item.map(item => item.data));
    }
    
    /**
     * 清空缓存
     */
    clearCache(): void {
        this.cache.clear();
    }
    
    /**
     * 获取连接状态
     * @returns 是否已连接
     */
    getConnectionStatus(): boolean {
        return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
    }
    
    /**
     * 获取当前订阅的资产ID列表
     * @returns 资产ID数组
     */
    getSubscribedAssetIds(): string[] {
        return [...this.subscribedAssetIds];
    }
    
    /**
     * 关闭连接
     */
    disconnect(): void {
        if(!this.isConnected) {
            return
        }
        this.isManualDisconnect = true; // 标记为主动断开
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
        this.clearCache();
        this.subscribedAssetIds = [];
        this.onWatchOrderBookPriceChangeCb = () => {};
        logInfo('[PolyMarketData] WebSocket 连接已断开');
    }


    onWatchOrderBookPriceChange(callback: (data: MarketPushData) => void) {
        this.onWatchOrderBookPriceChangeCb = callback;
    }

    async getLatestPriceChangeByAssetId(assetId: string): Promise<MarketPushData | null> {
        if (this.cache.size === 0 || !this.cache.get(assetId)) {
            logInfo(`[PolyMarketData] No data found in cache for assetId: ${assetId}, getting from clob...`);
            const data = await getClobModule().getOrderBookSummary(assetId)
            return pick(data, ['bids', 'asks', 'market', 'asset_id', 'timestamp']) as any as  MarketPushData;
        }
        return this.cache.get(assetId)![this.cache.get(assetId)!.length - 1].data;
    }
    getBestAskByAssetId(assetId: string): number | null {
        if (this.cache.size === 0 || !this.cache.get(assetId)) {
            return null;
        }
        const orderbookSummary = this.cache.get(assetId)![this.cache.get(assetId)!.length - 1].data;
        return Number(orderbookSummary.asks[orderbookSummary.asks.length - 1]?.price);
    }
}

export const polyMarketDataClient = new PolyMarketDataClient();


/**
 * Polymarket WebSocket 实时数据连接类
 * 用于连接 Polymarket 的 WebSocket 服务，订阅实时数据并缓存
 */

import WebSocket from 'ws';
import { getGlobalConfig } from './config';
import { logData, logInfo, logPriceData } from '../module/logger';

// 订阅信息接口
interface Subscription {
    topic: string;
    type: string;
    filters: string | Record<string, any>;
}

// 订阅请求接口
interface SubscribeRequest {
    action: 'subscribe';
    subscriptions: Subscription[];
}

// 推送数据接口
interface PushData {
    connection_id?: string;
    payload: any;
    timestamp: number;
    topic: string;
    type: string;
}

// 缓存数据项接口
interface CachedData {
    data: PushData;
    cachedAt: number;
}

/**
 * Polymarket WebSocket 实时数据客户端
 */
class PolyLiveDataClient {
    private ws: WebSocket | null = null;
    private url: string = 'wss://ws-live-data.polymarket.com/';
    private isConnected: boolean = false;
    private isManualDisconnect: boolean = false; // 标记是否是主动断开
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5;
    private reconnectDelay: number = 3000; // 3秒

    private maxCacheSize: number; // 每个 topic 最大缓存数量
    // 全局数据缓存：使用 Map 存储，key 为 topic，value 为数据数组
    private cache: Map<string, CachedData[]> = new Map();
    // 订阅列表
    private subscriptions: Subscription[] = [];

    private onWatchPriceChangeCb: (currentPrice: { value: number, timestamp: number }, historyPriceList: {value: number, timestamp: number}[]) => void = () => { };

    /**
     * 构造函数
     * @param url WebSocket 服务器地址，默认为 Polymarket 地址
     * @param maxCacheSize 每个 topic 的最大缓存数量，默认 1000
     */
    constructor() {
        const globalConfig = getGlobalConfig();
        this.url = globalConfig.ws.liveDataUrl;
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
                    logInfo('[PolyLiveData] WebSocket 连接已建立');
                    this.isConnected = true;
                    this.isManualDisconnect = false; // 重置主动断开标志
                    this.reconnectAttempts = 0;

                    // 连接成功后，重新订阅之前的订阅
                    if (this.subscriptions.length > 0) {
                        this.sendSubscriptions(this.subscriptions);
                    }

                    resolve();
                });

                this.ws.on('message', (data: WebSocket.Data) => {
                    this.handleMessage(data);
                });

                this.ws.on('error', (error: Error) => {
                    logInfo('[PolyLiveData] WebSocket 错误:', error);
                    this.isConnected = false;
                    if (this.reconnectAttempts === 0) {
                        reject(error);
                    }
                });

                this.ws.on('close', (code: number, reason: Buffer) => {
                    logInfo(`[PolyLiveData] WebSocket 连接已关闭: ${code} - ${reason.toString()}`);
                    this.isConnected = false;
                    this.ws = null;

                    // 只有在非主动断开的情况下才尝试重连
                    if (!this.isManualDisconnect) {
                        this.attemptReconnect();
                    } else {
                        logInfo('[PolyLiveData] 主动断开连接，不进行重连');
                    }
                });

            } catch (error) {
                logInfo(`[PolyLiveData] 连接失败: ${error}`);
                reject(error);
            }
        });
    }

    public getHistoryPriceList(topic: string): {value: number, timestamp: number}[] {
        const topicCache = this.cache.get(topic);
        if (!topicCache) {
            return [];
        }
        return topicCache.map(item => ({value: Number(item.data.payload.value), timestamp: Number(item.data.payload.timestamp)}));
    }

    /**
     * 处理接收到的消息
     */
    private handleMessage(data: WebSocket.Data): void {
        try {
            if(data.toString()) {
                const message = JSON.parse(data.toString());

                if (message.topic === 'crypto_prices_chainlink') {
                    logPriceData(message.payload.value, message.payload.symbol, message.payload.timestamp);
                    this.cacheData(message);
                    this.onWatchPriceChangeCb?.({ 
                        value: Number(message.payload.value), 
                        timestamp: Number(message.payload.timestamp) 
                    }, this.getHistoryPriceList(message.topic));
                }
            }
        } catch (error) {
            logInfo(`[PolyLiveData] 解析消息失败: ${error} data: ${data.toString()}`);
        }
    }

    /**
     * 缓存数据
     */
    private cacheData(data: PushData): void {
        const topic = data.topic;

        if (!this.cache.has(topic)) {
            this.cache.set(topic, []);
        }

        const topicCache = this.cache.get(topic)!;
        const cachedItem: CachedData = {
            data,
            cachedAt: Date.now()
        };

        // 添加到缓存
        topicCache.push(cachedItem);

        // 如果超过最大缓存数量，移除最旧的数据
        if (topicCache.length > this.maxCacheSize) {
            topicCache.shift();
        }
    }

    /**
     * 发送订阅请求
     */
    private sendSubscriptions(subscriptions: Subscription[]): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('[PolyLiveData] WebSocket 未连接，无法发送订阅');
            return;
        }

        const request: SubscribeRequest = {
            action: 'subscribe',
            subscriptions: subscriptions.map(sub => ({
                ...sub,
                filters: typeof sub.filters === 'string' ? sub.filters : JSON.stringify(sub.filters)
            }))
        };

        const message = JSON.stringify(request);
        this.ws.send(message);
        logInfo('[PolyLiveData] 发送订阅请求', message);
    }

    /**
     * 尝试重连
     */
    private attemptReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logInfo('[PolyLiveData] 达到最大重连次数，停止重连');
            return;
        }

        this.reconnectAttempts++;
        logInfo(`[PolyLiveData] ${this.reconnectDelay / 1000}秒后尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

        setTimeout(() => {
            this.connect().catch((error) => {
                logInfo('[PolyLiveData] 重连失败:', error);
            });
        }, this.reconnectDelay);
    }

    /**
     * 订阅加密货币价格数据（Chainlink）
     * @param symbol 交易对符号，如 'eth/usd'
     */
    subscribeCryptoPrices(symbol: string): void {
        const subscription: Subscription = {
            topic: 'crypto_prices_chainlink',
            type: 'update',
            filters: JSON.stringify({ symbol })
        };

        this.subscriptions.push(subscription);

        if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
            this.sendSubscriptions([subscription]);
        }
    }

    /**
     * 通用订阅方法
     * @param topic 主题
     * @param type 类型
     * @param filters 过滤器（对象或字符串）
     */
    subscribe(topic: string, type: string, filters: string | Record<string, any>): void {
        const subscription: Subscription = {
            topic,
            type,
            filters
        };

        this.subscriptions.push(subscription);

        if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
            this.sendSubscriptions([subscription]);
        }
    }

    /**
     * 获取指定 topic 的缓存数据
     * @param topic 主题名称
     * @returns 缓存数据数组
     */
    getCache(topic: string): PushData[] {
        const topicCache = this.cache.get(topic);
        if (!topicCache) {
            return [];
        }
        return topicCache.map(item => item.data);
    }

    /**
     * 获取指定 topic 的最新数据
     * @param topic 主题名称
     * @returns 最新的数据，如果没有则返回 null
     */
    getLatest(topic: string): PushData | null {
        const topicCache = this.cache.get(topic);
        if (!topicCache || topicCache.length === 0) {
            return null;
        }
        return topicCache[topicCache.length - 1].data;
    }

    /**
     * 获取所有缓存的主题列表
     * @returns 主题名称数组
     */
    getTopics(): string[] {
        return Array.from(this.cache.keys());
    }

    /**
     * 清空指定 topic 的缓存
     * @param topic 主题名称，如果不提供则清空所有缓存
     */
    clearCache(topic?: string): void {
        if (topic) {
            this.cache.delete(topic);
        } else {
            this.cache.clear();
        }
    }

    /**
     * 获取连接状态
     * @returns 是否已连接
     */
    getConnectionStatus(): boolean {
        return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
    }

    /**
     * 关闭连接
     */
    disconnect(): void {
        if (!this.isConnected) {
            return
        }
        this.isManualDisconnect = true; // 标记为主动断开
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
        this.clearCache();
        this.subscriptions = [];
        this.onWatchPriceChangeCb = () => { };
        logInfo('[PolyLiveData] WebSocket 连接已断开');
    }



    onWatchPriceChange(callback: (price: { value: number, timestamp: number }, historyPriceList: {value: number, timestamp: number}[]) => any) {
        this.onWatchPriceChangeCb = callback;
    }

    getPriceFromData(data: PushData) {
        if (data.topic === 'crypto_prices_chainlink') {
            return data.payload.value;
        }
        return null;
    }

    getLatestCryptoPricesFromChainLink(): number | null {
        const topic = `crypto_prices_chainlink`;
        const data = this.getLatest(topic);
        if (data) {
            return Number(data.payload.value)
        }
        return null;
    }
}

export const polyLiveDataClient = new PolyLiveDataClient();
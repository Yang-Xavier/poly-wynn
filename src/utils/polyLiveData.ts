/**
 * Polymarket WebSocket 实时数据连接类
 * 用于连接 Polymarket 的 WebSocket 服务，订阅实时数据并缓存
 */

import type WebSocket from 'ws';
import { getGlobalConfig } from './config';
import { logInfo, logPriceData } from '../module/logger';
import { BaseLiveDataClient } from 'src/module/BaseLiveDataClient';

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

/**
 * Polymarket WebSocket 实时数据客户端
 * 继承基础 WebSocket 客户端，仅实现自身的消息处理、缓存和订阅逻辑
 */
class PolyLiveDataClient extends BaseLiveDataClient {
    private topic: string = 'crypto_prices_chainlink';

    // 订阅列表
    private subscriptions: Subscription[] = [];

    /**
     * 构造函数
     * @param url WebSocket 服务器地址，默认为 Polymarket 地址
     * @param maxCacheSize 每个 topic 的最大缓存数量，默认 1000
     */
    constructor() {
        const globalConfig = getGlobalConfig();
        super({
            url: globalConfig.ws.liveDataUrl,
            name: 'PolyLiveData',
            maxCacheSize: globalConfig.ws.maxCacheSize,
        });
    }

    public getHistoryPriceList(topic: string): {value: number, timestamp: number}[] {
        const list = this.getCachedList<PushData>(topic);
        if (!list || list.length === 0) {
            return [];
        }
        return list.map(item => ({
            value: Number(item.payload.value),
            timestamp: Number(item.payload.timestamp),
        }));
    }

    /**
     * 连接成功时的回调：重新发送已有订阅
     */
    protected onOpen(): void {
        if (this.subscriptions.length > 0) {
            this.sendSubscriptions(this.subscriptions);
        }
    }

    /**
     * 处理接收到的消息
     */
    protected onMessage(data: WebSocket.Data): void {
        try {
            if(data.toString()) {
                const message = JSON.parse(data.toString()) as PushData;

                if (message.topic === this.topic) {
                    logPriceData(message.payload.value, message.payload.symbol, message.payload.timestamp);
                    // 使用基础类统一的缓存策略，key 为 topic
                    this.cacheItem(message.topic, message);
                    this.invokeCallback(
                        'watchPriceChange',
                        { 
                        value: Number(message.payload.value), 
                        timestamp: Number(message.payload.timestamp) 
                        },
                        this.getHistoryPriceList(this.topic)
                    );
                }
            }
        } catch (error) {
            logInfo(`[PolyLiveData] 解析消息失败: ${error} data: ${data.toString()}`);
        }
    }

    /**
     * 发送订阅请求
     */
    private sendSubscriptions(subscriptions: Subscription[]): void {
        if (!this.ws || this.ws.readyState !== 1) {
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

        if (this.isConnected && this.ws?.readyState === 1) {
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

        if (this.isConnected && this.ws?.readyState === 1) {
            this.sendSubscriptions([subscription]);
        }
    }

    /**
     * 获取所有缓存的主题列表
     * @returns 主题名称数组
     */
    getTopics(): string[] {
        return this.getAllCacheKeys();
    }

    /**
     * 清空指定 topic 的缓存
     * @param topic 主题名称，如果不提供则清空所有缓存
     */
    clearCache(topic?: string): void {
        if (topic) {
            this.clearCacheByKey(topic);
        } else {
            this.clearAllCache();
        }
    }

    /**
     * 断开连接时子类的清理逻辑
     */
    protected onDisconnectCleanup(): void {
        this.clearCache();
        this.subscriptions = [];
    }

    onWatchPriceChange(callback: (price: { value: number, timestamp: number }, historyPriceList: {value: number, timestamp: number}[]) => any) {
        this.setCallback('watchPriceChange', callback);
    }

    getLatestCryptoPricesFromChainLink(): number | null {
        const topic = `crypto_prices_chainlink`;
        const data = this.getLatestCached<PushData>(topic);
        if (data) {
            return Number(data.payload.value)
        }
        return null;
    }

    getHistoryPriceListFromChainLink(): {value: number, timestamp: number}[] {
        return this.getHistoryPriceList(this.topic)
    }
}

export const polyLiveDataClient = new PolyLiveDataClient();
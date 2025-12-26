import WebSocket from 'ws';
import { logInfo } from './logger';

interface BaseCachedItem<T = any> {
    data: T;
    cachedAt: number;
}

type BaseCallback = (...args: any[]) => void;

/**
 * WebSocket 实时数据基础客户端
 * 抽取了连接、重连、关闭以及统一的缓存策略和回调管理
 */
export abstract class BaseLiveDataClient {
    protected ws: WebSocket | null = null;
    protected url: string;
    protected isConnected: boolean = false;

    // 统一的缓存容器：key 由子类控制（如 asset_id / topic），data 结构由子类决定
    protected cache: Map<string, BaseCachedItem[]> = new Map();

    private isManualDisconnect: boolean = false;
    private reconnectAttempts: number = 0;
    private readonly maxReconnectAttempts: number;
    private readonly reconnectDelay: number;
    private readonly name: string;
    private readonly maxCacheSize: number;

    // 统一的回调容器：key 表示回调名称，由子类约定
    private callbacks: Map<string, BaseCallback> = new Map();

    constructor(options: {
        url: string;
        name: string;
        maxReconnectAttempts?: number;
        reconnectDelay?: number;
        maxCacheSize?: number;
    }) {
        this.url = options.url;
        this.name = options.name;
        this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
        this.reconnectDelay = options.reconnectDelay ?? 3000;
        this.maxCacheSize = options.maxCacheSize ?? 1000;
    }

    /**
     * 子类在连接成功后执行的逻辑（如重新订阅）
     */
    protected abstract onOpen(): void;

    /**
     * 子类处理消息的逻辑
     */
    protected abstract onMessage(data: WebSocket.Data): void;

    /**
     * 子类在断开连接时需要做的清理逻辑（如清空缓存、重置回调等）
     */
    protected abstract onDisconnectCleanup(): void;

    /**
     * 建立 WebSocket 连接
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
                    logInfo(`[${this.name}] WebSocket 连接已建立`);
                    this.isConnected = true;
                    this.isManualDisconnect = false;
                    this.reconnectAttempts = 0;

                    try {
                        this.onOpen();
                    } catch (err) {
                        logInfo(`[${this.name}] onOpen 处理异常: ${err}`);
                    }

                    resolve();
                });

                this.ws.on('message', (data: WebSocket.Data) => {
                    this.onMessage(data);
                });

                this.ws.on('error', (error: Error) => {
                    logInfo(`[${this.name}] WebSocket 错误: ${error}`);
                    this.isConnected = false;
                    if (this.reconnectAttempts === 0) {
                        reject(error);
                    }
                });

                this.ws.on('close', (code: number, reason: Buffer) => {
                    logInfo(`[${this.name}] WebSocket 连接已关闭: ${code} - ${reason.toString()}`);
                    this.isConnected = false;
                    this.ws = null;

                    if (!this.isManualDisconnect) {
                        this.attemptReconnect();
                    } else {
                        logInfo(`[${this.name}] 主动断开连接，不进行重连`);
                    }
                });
            } catch (error) {
                logInfo(`[${this.name}] 连接失败: ${error}`);
                reject(error);
            }
        });
    }

    /**
     * 尝试重连
     * 注意：如果已经被标记为主动断开（isManualDisconnect=true），则不再进行任何重连尝试
     */
    protected attemptReconnect(): void {
        if (this.isManualDisconnect) {
            logInfo(`[${this.name}] 已主动断开，不再尝试重连`);
            return;
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logInfo(`[${this.name}] 达到最大重连次数，停止重连`);
            return;
        }

        this.reconnectAttempts++;
        logInfo(
            `[${this.name}] ${this.reconnectDelay / 1000}秒后尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
        );

        setTimeout(() => {
            // 在真正重连前再次检查是否已经被主动断开
            if (this.isManualDisconnect) {
                logInfo(`[${this.name}] 已主动断开，取消本次重连`);
                return;
            }
            this.connect().catch((error) => {
                logInfo(`[${this.name}] 重连失败: ${error}`);
            });
        }, this.reconnectDelay);
    }

    /**
     * 统一的缓存写入策略：按 key 追加，超出 maxCacheSize 时移除最旧的数据
     */
    protected cacheItem<T = any>(key: string, data: T): void {
        if (!this.cache.has(key)) {
            this.cache.set(key, []);
        }
        const bucket = this.cache.get(key)!;
        bucket.push({
            data,
            cachedAt: Date.now(),
        });
        if (bucket.length > this.maxCacheSize) {
            bucket.shift();
        }
    }

    /**
     * 获取某个 key 下的所有缓存数据（仅返回 data 部分）
     */
    protected getCachedList<T = any>(key: string): T[] {
        const bucket = this.cache.get(key);
        if (!bucket) return [];
        return bucket.map((item) => item.data as T);
    }

    /**
     * 获取某个 key 下最新的一条缓存数据
     */
    protected getLatestCached<T = any>(key: string): T | null {
        const bucket = this.cache.get(key);
        if (!bucket || bucket.length === 0) return null;
        return bucket[bucket.length - 1].data as T;
    }

    /**
     * 获取当前所有缓存 key
     */
    protected getAllCacheKeys(): string[] {
        return Array.from(this.cache.keys());
    }

    /**
     * 清空全部缓存
     */
    protected clearAllCache(): void {
        this.cache.clear();
    }

    /**
     * 删除指定 key 的缓存
     */
    protected clearCacheByKey(key: string): void {
        this.cache.delete(key);
    }

    /**
     * 注册（或取消）回调
     * name 由子类自行约定，callback 传 null 时表示移除
     */
    protected setCallback(name: string, callback: BaseCallback | null): void {
        if (callback) {
            this.callbacks.set(name, callback);
        } else {
            this.callbacks.delete(name);
        }
    }

    /**
     * 触发指定名称的回调
     */
    protected invokeCallback(name: string, ...args: any[]): void {
        const cb = this.callbacks.get(name);
        if (!cb) return;
        try {
            cb(...args);
        } catch (err) {
            logInfo(`[${this.name}] callback "${name}" 执行异常: ${err}`);
        }
    }

    /**
     * 清除某个回调
     */
    protected clearCallback(name: string): void {
        this.callbacks.delete(name);
    }

    /**
     * 清除全部回调
     */
    protected clearAllCallbacks(): void {
        this.callbacks.clear();
    }

    /**
     * 获取连接状态
     */
    getConnectionStatus(): boolean {
        return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
    }

    /**
     * 关闭连接
     * 无论当前是否已连接，都会标记为主动断开，从而阻止后续任何自动重连
     */
    disconnect(): void {
        // 标记为主动断开，阻止后续 attemptReconnect 生效
        this.isManualDisconnect = true;

        if (!this.isConnected && !this.ws) {
            // 已经处于断开状态，仅做清理和标记
            this.onDisconnectCleanup();
            this.clearAllCallbacks();
            logInfo(`[${this.name}] WebSocket 已是断开状态（主动关闭）`);
            return;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.isConnected = false;
        this.onDisconnectCleanup();
        this.clearAllCallbacks();
        logInfo(`[${this.name}] WebSocket 连接已断开`);
    }
}



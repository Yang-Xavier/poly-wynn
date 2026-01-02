/**
 * 简单的列表缓存类
 * 维护一个列表，支持 maxSize 限制
 */
export class Cache<T> {
  private list: T[] = [];
  private readonly maxSize?: number;

  /**
   * 构造函数
   * @param maxSize 最大列表长度，超过此数量会清理最旧的数据
   *                如果为 undefined 或 0，则不限制数量
   */
  constructor(maxSize?: number) {
    this.maxSize = maxSize;
  }

  /**
   * 向列表末尾添加元素
   * @param item 要添加的元素
   */
  push(item: T): void {
    this.list.push(item);
    this.cleanup();
  }

  /**
   * 批量向列表末尾添加元素
   * @param items 要添加的元素数组
   */
  pushMany(items: T[]): void {
    this.list.push(...items);
    this.cleanup();
  }

  /**
   * 获取列表
   * @returns 列表的副本
   */
  getList(): T[] {
    return [...this.list];
  }

  /**
   * 获取列表长度
   * @returns 列表长度
   */
  size(): number {
    return this.list.length;
  }

  /**
   * 获取最新的一条数据
   * @returns 最新的元素，如果列表为空则返回 undefined
   */
  getLatest(): T | undefined {
    return this.list.length > 0 ? this.list[this.list.length - 1] : undefined;
  }

  /**
   * 清空列表
   */
  clear(): void {
    this.list = [];
  }

  /**
   * 清理最旧的数据（当超过最大数量时）
   */
  private cleanup(): void {
    if (!this.maxSize || this.maxSize <= 0) {
      return;
    }

    // 如果当前长度未超过限制，不需要清理
    if (this.list.length <= this.maxSize) {
      return;
    }

    // 计算需要删除的数量
    const deleteCount = this.list.length - this.maxSize;

    // 删除最前面的元素（最旧的数据）
    this.list.splice(0, deleteCount);
  }
}

/**
 * Cache 项信息接口
 */
interface CacheItemInfo<T> {
  cache: Cache<T>; // Cache 实例
  expire: number; // 到期时间戳（毫秒）
  createdAt: number; // 创建时间戳（毫秒）
  maxSize: number; // 最大列表长度
}

/**
 * Cache 高阶控制器
 * 管理多个 Cache 实例，支持过期时间管理
 */
export class CacheController<T> {
  private cacheMap: Map<string, CacheItemInfo<T>> = new Map();

  /**
   * 创建 Cache
   * @param key Cache 的键
   * @param maxSize 最大列表长度
   * @param expire 到期时间
   * @param createdAt 首次存入的时间戳（毫秒），如果不提供则使用当前时间
   * @returns 创建的 Cache 实例
   */
  createCache(key: string, maxSize: number, expire: number, createdAt?: number): Cache<T> {
    const now = createdAt || Date.now();

    const cache = new Cache<T>(maxSize);
    const cacheItemInfo: CacheItemInfo<T> = {
      cache,
      expire,
      createdAt: now,
      maxSize,
    };

    this.cacheMap.set(key, cacheItemInfo);
    return cache;
  }

  /**
   * 获取 Cache
   * @param key Cache 的键
   * @returns Cache 实例，如果不存在或已过期则返回 undefined
   */
  getCache(key: string): Cache<T> | undefined {
    const cacheItemInfo = this.cacheMap.get(key);
    if (!cacheItemInfo) {
      return undefined;
    }

    // 检查是否过期
    if (this.isExpired(cacheItemInfo)) {
      // 已过期，清理并删除
      this.cleanAndDelete(key);
      return undefined;
    }

    return cacheItemInfo.cache;
  }

  /**
   * 检查 Cache 是否存在且未过期
   * @param key Cache 的键
   * @returns 是否存在且未过期
   */
  hasCache(key: string): boolean {
    const cacheItemInfo = this.cacheMap.get(key);
    if (!cacheItemInfo) {
      return false;
    }

    // 检查是否过期
    if (this.isExpired(cacheItemInfo)) {
      // 已过期，清理并删除
      this.cleanAndDelete(key);
      return false;
    }

    return true;
  }

  /**
   * 判断 Cache 是否过期
   * @param key Cache 的键
   * @returns 是否过期，如果不存在则返回 false
   */
  isCacheExpired(key: string): boolean {
    const cacheItemInfo = this.cacheMap.get(key);
    if (!cacheItemInfo) {
      return false;
    }

    return this.isExpired(cacheItemInfo);
  }

  /**
   * 检查并清理过期的 Cache
   * @returns 返回所有被清理的 key 数组
   */
  checkAndCleanExpired(): string[] {
    const expiredKeys: string[] = [];

    for (const [key, cacheItemInfo] of this.cacheMap.entries()) {
      if (this.isExpired(cacheItemInfo)) {
        expiredKeys.push(key);
        this.cleanAndDelete(key);
      }
    }

    return expiredKeys;
  }

  /**
   * 清理并删除指定的 Cache
   * @param key Cache 的键
   * @returns 是否成功删除
   */
  cleanAndDelete(key: string): boolean {
    const cacheItemInfo = this.cacheMap.get(key);
    if (!cacheItemInfo) {
      return false;
    }

    // 清理 Cache
    cacheItemInfo.cache.clear();

    // 从 Map 中删除
    return this.cacheMap.delete(key);
  }

  /**
   * 删除指定的 Cache（不清理数据）
   * @param key Cache 的键
   * @returns 是否成功删除
   */
  delete(key: string): boolean {
    return this.cacheMap.delete(key);
  }

  /**
   * 清空所有 Cache
   */
  clear(): void {
    // 清理所有 Cache
    for (const cacheItemInfo of this.cacheMap.values()) {
      cacheItemInfo.cache.clear();
    }
    this.cacheMap.clear();
  }

  /**
   * 获取所有 Cache 的键
   * @returns 键数组（自动过滤过期项）
   */
  keys(): string[] {
    const keys: string[] = [];
    const expiredKeys: string[] = [];

    for (const [key, cacheItemInfo] of this.cacheMap.entries()) {
      if (this.isExpired(cacheItemInfo)) {
        expiredKeys.push(key);
      } else {
        keys.push(key);
      }
    }

    // 清理过期项
    for (const key of expiredKeys) {
      this.cleanAndDelete(key);
    }

    return keys;
  }

  /**
   * 获取 Cache 数量
   * @returns 当前 Cache 数量（自动过滤过期项）
   */
  size(): number {
    // 先清理过期项
    this.checkAndCleanExpired();
    return this.cacheMap.size;
  }

  /**
   * 获取 Cache 的过期时间
   * @param key Cache 的键
   * @returns 过期时间戳，如果不存在或已过期则返回 undefined
   */
  getExpireTime(key: string): number | undefined {
    const cacheItemInfo = this.cacheMap.get(key);
    if (!cacheItemInfo) {
      return undefined;
    }

    // 检查是否过期
    if (this.isExpired(cacheItemInfo)) {
      this.cleanAndDelete(key);
      return undefined;
    }

    return cacheItemInfo.expire;
  }

  /**
   * 获取 Cache 的创建时间
   * @param key Cache 的键
   * @returns 创建时间戳，如果不存在或已过期则返回 undefined
   */
  getCreatedAt(key: string): number | undefined {
    const cacheItemInfo = this.cacheMap.get(key);
    if (!cacheItemInfo) {
      return undefined;
    }

    // 检查是否过期
    if (this.isExpired(cacheItemInfo)) {
      this.cleanAndDelete(key);
      return undefined;
    }

    return cacheItemInfo.createdAt;
  }

  /**
   * 判断 CacheItemInfo 是否过期
   * @param cacheItemInfo Cache 项信息
   * @returns 是否过期
   */
  private isExpired(cacheItemInfo: CacheItemInfo<T>): boolean {
    const now = Date.now();
    return now >= cacheItemInfo.expire;
  }
}

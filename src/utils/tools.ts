import {  OrderBookSummary } from "../module/clob";
import { getGlobalConfig } from "./config";
import { OUTCOMES_ENUM } from "./constans";


// 计算当前时间属于哪个15分钟区间，并返回该区间开始的时间戳（单位：秒）
// 支持传入参数 n，获取下 n 个 interval（n 默认为 0，表示当前 interval）
export const get15MinIntervalTimestamp = (n: number = 0) => {
    const now = Date.now();
    const interval = 15 * 60 * 1000; // 15分钟对应的毫秒数
    const intervalStart = now - (now % interval) + (n * interval);
    return Math.floor(intervalStart / 1000); // 返回秒级时间戳
}

export const getMarketSlug15Min = (market: string, intervalTimestamp: number) => {
    return `${market}-updown-15m-${intervalTimestamp}`;
}

export const distanceToNextInterval = (intervalTimestamp: number) => {
    const now = Date.now();
    const interval = 15 * 60 * 1000;
    const nextIntervalStart = intervalTimestamp * 1000 + interval;
    const msUntilNextInterval = nextIntervalStart - now;
    return msUntilNextInterval;
}

export const isLessThan5Minutes = (msUntilNextInterval: number) => {
    return msUntilNextInterval < 5 * 60 * 1000;
}

export const isGreaterThan90 = (price: string) => {
    return parseFloat(price) >= 0.90;
}

// 计算 asks 的累计订单深度（价格由低到高），返回每个价格对应的累计数量
export const getAsksDepth = (orderbookSummary: OrderBookSummary) => {
    if (!orderbookSummary || !orderbookSummary.asks) {
        return [];
    }
    let cumulative = 0;
    // asks 从低到高排序（通常已经是），逐个累计
    return orderbookSummary.asks.map(({ price, size }) => {
        cumulative += parseFloat(size);
        return { price, cumulativeSize: cumulative };
    });
}


export enum TOKEN_ACTION_ENUM {
    sell = 'sell',
    won = "won",
    hold = "hold"
};

export const runIntervalFn = (
    fn: (context: { setInterval: (ms: number) => void }) => Promise<void>,
    interval: number = 0
) => {
    let currentInterval = interval;
    let stopped = false;

    const context = {
        setInterval: (ms: number) => {
            currentInterval = ms;
        }
    };

    const runner = async () => {
        while (!stopped) {
            await fn(context);
            await new Promise(resolve => setTimeout(resolve, currentInterval));
        }
    };

    runner();

    return {
        stop: () => { stopped = true; },
        setInterval: (ms: number) => { currentInterval = ms; }
    };
};

export const runFnDelay = async (fn: () => Promise<void>, delay: number) => {
    await new Promise(resolve => setTimeout(resolve, delay));
    await fn();
}

export const waitFor = async (ms: number) => {
    await new Promise(resolve => setTimeout(resolve, ms>0?ms:0));
}

export const omit = (obj: any, keys: string[]) => {
    return Object.fromEntries(Object.entries(obj).filter(([key]) => !keys.includes(key)));
}

export const pick = (obj: any, keys: string[]) => {
    return Object.fromEntries(Object.entries(obj).filter(([key]) => keys.includes(key)));
}

export const calcPriceRange = (priceToBeat: number, range: number[]) => {
    const [maxRatio, minRatio] = range;
    const upRange = [(1+minRatio)*priceToBeat, (1+maxRatio)*priceToBeat] as [number, number];
    const downRange = [(1-maxRatio)*priceToBeat, (1-minRatio)*priceToBeat] as [number, number];
    return { upRange, downRange };
}
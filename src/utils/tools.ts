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
    won = "won"
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
    await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 计算衰减因子：随着 y 坐标的减小，x 坐标要减小得越来越快
 * @param range - 二维数组，range[0] 是 x 轴范围 [x1, x2]，range[1] 是 y 轴范围 [y1, y2]（不要求前小后大）
 * @param y - 输入的 y 坐标值
 * @returns 计算出的 x 坐标值
 */
export const calcAttenuationFactor = (range: number[][], y: number) => {
    const [xRange, yRange] = range;
    const [x1, x2] = xRange;
    const [y1, y2] = yRange;

    // 允许传入 [max, min] 或 [min, max]，这里统一转成 [min, max]
    const xMin = Math.min(x1, x2);
    const xMax = Math.max(x1, x2);
    const yMin = Math.min(y1, y2);
    const yMax = Math.max(y1, y2);

    if (yMax === yMin) {
        return xMin;
    }

    // 将 y 归一化到 [0, 1]，y = yMin -> 0，y = yMax -> 1
    let yNormalized = (y - yMin) / (yMax - yMin);
    // 防止越界
    yNormalized = Math.max(0, Math.min(1, yNormalized));

    // 设计成：y 从大到小（1 -> 0），x 从大到小但越到后面减得越快
    // 做法：用 1 - (1 - yNormalized)^2 这条曲线
    // - yNormalized = 1 -> xNormalized = 1
    // - yNormalized = 0 -> xNormalized = 0
    // 且越靠近 yMin（yNormalized 越小），斜率越大，满足“y 越小，x 减得越快”
    const xNormalized = 1 - Math.pow(1 - yNormalized, 2);

    // 将归一化的 x 映射回实际范围
    const x = xMin + (xMax - xMin) * xNormalized;

    return x;
}


export const calcDiffBeatPrice = (price: string | number, priceToBeat: string | number, diffBeatPriceFactor: number[], distance: number) => {
    const globalConfig = getGlobalConfig();
    const timeBasedRatio = calcAttenuationFactor([diffBeatPriceFactor.reverse(), [0, globalConfig.stratgegy.startBefore]], distance);

    // price diff ratio
    const diff = Math.abs(Number(price) - Number(priceToBeat));
    const diffRatio = diff / Number(priceToBeat);

    return {
        isDiffEnough: diffRatio >= timeBasedRatio,
        timeBasedRatio,
        diffRatio,
        outcome: Number(price) > Number(priceToBeat) ? OUTCOMES_ENUM.Up : OUTCOMES_ENUM.Down
    };
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
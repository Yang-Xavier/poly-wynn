import { getGlobalConfig } from "./config";
import { OUTCOMES_ENUM } from "./constans";
import { TOKEN_ACTION_ENUM } from "./tools";


/**
 * 价格突破某个价格的概率结果
 * - upBreakProbability: 收盘价高于/等于 breakPrice 的概率
 * - downBreakProbability: 收盘价低于/等于 breakPrice 的概率
 */
export interface BreakoutProbabilityResult {
    upBreakProbability: number;    // 0 ~ 1
    downBreakProbability: number;  // 0 ~ 1
    /**
     * 估计得到的单步对数收益均值（历史样本）
     */
    meanLogReturnPerStep: number;
    /**
     * 估计得到的单步对数收益波动率（标准差，历史样本）
     */
    volatilityPerStep: number;
    /**
     * 以“一个价格点为一个时间步”估算，未来大概还有多少个时间步
     */
    stepsAhead: number;
}

/**
 * 带时间戳的价格点，用于 tick 级别的数据
 * - timestamp 可以是毫秒时间戳数字，或者可以被 new Date() 解析的字符串
 */
export interface PriceTickPoint {
    value: number;
    timestamp: number | string;
}

// 误差函数 erf 的近似实现（Abramowitz and Stegun 7.1.26）
const erf = (x: number): number => {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);

    // 常用近似参数
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const t = 1 / (1 + p * ax);
    const y =
        1 -
        (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
        Math.exp(-ax * ax);

    return sign * y;
};

// 标准正态分布的 CDF
const normalCdf = (x: number): number => {
    return 0.5 * (1 + erf(x / Math.SQRT2));
};

/**
 * 辅助：将 timestamp（number | string）转换为毫秒时间戳
 */
const toMs = (ts: number | string): number => {
    if (typeof ts === "number") return ts;
    const t = new Date(ts).getTime();
    return isNaN(t) ? 0 : t;
};

/**
 * 使用 tick 结构（带时间戳），自动推断 historyDurationMs，
 * 避免手动传入。
 *
 * @param ticks 价格 tick 数组，按时间顺序排列（如不确定是否有序，本函数会重新排序一次）
 * @param timeToExpiryMs 剩余倒计时时间（毫秒）
 * @param breakPrice 需要判断是否突破的价格
 */
export const calcBreakoutProbabilityFromTicks = (
    ticks: PriceTickPoint[],
    timeToExpiryMs: number,
    breakPrice: number
): BreakoutProbabilityResult => {
    const n = ticks.length;
    if (n < 2) {
        return {
            upBreakProbability: 0.5,
            downBreakProbability: 0.5,
            meanLogReturnPerStep: 0,
            volatilityPerStep: 0,
            stepsAhead: 0
        };
    }

    // 按时间排序一次，确保有序（如果你在上游已经保证有序，这里也没问题）
    const sorted = [...ticks].sort(
        (a, b) => toMs(a.timestamp) - toMs(b.timestamp)
    );

    const firstTs = toMs(sorted[0].timestamp);
    const lastTs = toMs(sorted[sorted.length - 1].timestamp);
    const historyDurationMs = lastTs - firstTs;

    const prices = sorted.map((p) => p.value);

    // historyDurationMs <= 0 时，内部会自动 fallback 到全局配置
    const result = calcBreakoutProbability(
        prices,
        timeToExpiryMs,
        breakPrice,
        historyDurationMs > 0 ? historyDurationMs : undefined
    );
    return result
};

/**
 * 使用简化的几何布朗运动（GBM）假设，
 * 根据过去一段时间的价格序列，估计未来 timeToExpiryMs 之后
 * 收盘价向上/向下“突破”某个价格（breakPrice）的概率。
 *
 * 假设：
 * - prices 为等时间间隔采样（例如每秒/每 5 秒等），间隔由 sampleIntervalMs 指定
 * - 对数收益服从独立同分布的正态分布
 *
 * @param prices 过去一段时间的价格数组（按时间顺序），至少 2 个点
 * @param timeToExpiryMs 距离倒计时结束剩余的毫秒数（例如 15 分钟就传 15 * 60 * 1000）
 * @param breakPrice 需要判断是否突破的价格（例如当前 K 线的某个关键价）
 * @param sampleIntervalMs 相邻价格点之间的时间间隔（毫秒），默认 1000ms
 */
export const calcBreakoutProbability = (
    prices: number[],
    timeToExpiryMs: number,
    breakPrice: number,
    /**
     * （可选）这段 prices 覆盖的大致历史时长（毫秒）。
     * 如果不传，则默认使用全局配置中的 startBefore（例如 5 分钟），
     * 并假设当前这段历史价格大致覆盖了这么长的时间。
     *
     * 思路：无法精确知道每个 tick 的时间间隔时，就先估算：
     *   - 在 historyDurationMs 里一共出现了 logReturns.length 个 tick
     *   - 则未来 timeToExpiryMs 内预计会出现
     *       stepsAhead ≈ logReturns.length * timeToExpiryMs / historyDurationMs
     *     个“未来 tick”，用它作为 GBM 中的时间步数。
     */
    historyDurationMs?: number
): BreakoutProbabilityResult => {
    const n = prices.length;

    // 基本兜底：数据不足或参数不合法时，返回中性概率
    if (n < 2 || timeToExpiryMs <= 0 || breakPrice <= 0) {
        return {
            upBreakProbability: 0.5,
            downBreakProbability: 0.5,
            meanLogReturnPerStep: 0,
            volatilityPerStep: 0,
            stepsAhead: 0
        };
    }

    const lastPrice = prices[n - 1];
    if (lastPrice <= 0) {
        return {
            upBreakProbability: 0.5,
            downBreakProbability: 0.5,
            meanLogReturnPerStep: 0,
            volatilityPerStep: 0,
            stepsAhead: 0
        };
    }

    // 1. 计算历史对数收益 r_i = ln(P_i / P_{i-1})
    const logReturns: number[] = [];
    for (let i = 1; i < n; i++) {
        const pPrev = prices[i - 1];
        const pCurr = prices[i];
        if (pPrev > 0 && pCurr > 0) {
            logReturns.push(Math.log(pCurr / pPrev));
        }
    }

    const m = logReturns.length;
    if (m === 0) {
        return {
            upBreakProbability: 0.5,
            downBreakProbability: 0.5,
            meanLogReturnPerStep: 0,
            volatilityPerStep: 0,
            stepsAhead: 0
        };
    }

    const meanLogReturnPerStep =
        logReturns.reduce((sum, r) => sum + r, 0) / m;

    // 样本标准差
    let variance = 0;
    for (const r of logReturns) {
        const diff = r - meanLogReturnPerStep;
        variance += diff * diff;
    }
    variance /= Math.max(1, m - 1);
    const volatilityPerStep = Math.sqrt(variance);

    // 2. 估算未来“还剩多少步”（tick 数）
    //    无法确定单个 tick 的真实时间间隔时，用“历史这段 prices 覆盖的总时间”来推一个平均频率：
    //      - 历史时长 ≈ historyDurationMs
    //      - 历史 tick 数 = m
    //      - 未来时长 = timeToExpiryMs
    //      => 未来 tick 数 ≈ m * timeToExpiryMs / historyDurationMs
    const globalConfig = getGlobalConfig();
    const defaultHistoryDurationMs =
        typeof historyDurationMs === "number" && historyDurationMs > 0
            ? historyDurationMs
            : (globalConfig?.stratgegy?.startBefore ?? timeToExpiryMs);

    const stepsAhead = (m * timeToExpiryMs) / defaultHistoryDurationMs;

    if (!isFinite(stepsAhead) || stepsAhead <= 0) {
        return {
            upBreakProbability: 0.5,
            downBreakProbability: 0.5,
            meanLogReturnPerStep,
            volatilityPerStep,
            stepsAhead: 0
        };
    }

    // 3. 在 GBM 假设下：
    //    ln(S_T) ~ N( ln(S_0) + meanLogReturnPerStep * stepsAhead,
    //                volatilityPerStep^2 * stepsAhead )
    const meanLogST =
        Math.log(lastPrice) + meanLogReturnPerStep * stepsAhead;
    const varLogST = volatilityPerStep * volatilityPerStep * stepsAhead;
    const stdLogST = Math.sqrt(varLogST);

    // 如果波动率几乎为 0，则认为几乎确定不会大幅波动
    if (!isFinite(stdLogST) || stdLogST === 0) {
        const deterministic =
            lastPrice >= breakPrice
                ? { up: 1, down: 0 }
                : { up: 0, down: 1 };
        return {
            upBreakProbability: deterministic.up,
            downBreakProbability: deterministic.down,
            meanLogReturnPerStep,
            volatilityPerStep,
            stepsAhead
        };
    }

    // 4. 计算最终收盘价 S_T 高于/低于 breakPrice 的概率
    const logK = Math.log(breakPrice);
    const z = (logK - meanLogST) / stdLogST;

    // P(S_T <= K) = Φ(z)
    const downBreakProbability = normalCdf(z);
    // P(S_T >= K) = 1 - Φ(z)
    const upBreakProbability = 1 - downBreakProbability;

    return {
        upBreakProbability,
        downBreakProbability,
        meanLogReturnPerStep,
        volatilityPerStep,
        stepsAhead
    };
};

type TrendDirection = OUTCOMES_ENUM.Up | OUTCOMES_ENUM.Down;

export interface TrendResult {
    direction: TrendDirection;
    upProbability: number;    // 0 ~ 1
    downProbability: number;  // 0 ~ 1
    confidence: number;       // 趋势强度 0 ~ 1
}

/**
 * 根据一段时间内的价格数组，估计向上 / 向下趋势及其“概率”（置信度）
 * @param prices 价格数组，按时间顺序排列
 */
export function calcTrend(prices: {value: number, timestamp: number}[]): TrendResult {
    const n = prices.length;
    if (n < 2) {
        return {
            direction: OUTCOMES_ENUM.Up,
            upProbability: 0.5,
            downProbability: 0.5,
            confidence: 0
        };
    }

    const first = prices[0].value;
    const last = prices[n - 1].value;

    // 1. 整体涨跌幅
    const totalReturn = (Number(last) - Number(first)) / Number(first); // 比如 0.05 代表 +5%

    // 2. 统计每一步是涨还是跌
    let upCount = 0;
    let downCount = 0;
    for (let i = 1; i < n; i++) {
        const prev = prices[i - 1].value;
        const curr = prices[i].value;
        if (curr > prev) upCount++;
        else if (curr < prev) downCount++;
    }
    const steps = n - 1;
    const stepScore = steps > 0 ? (upCount - downCount) / steps : 0; // [-1, 1]

    // 3. 合成一个方向性得分（可按需要调权重）
    //   - totalReturn 反映首尾涨跌幅
    //   - stepScore 反映中间“多数时间”是涨还是跌
    const combinedRaw = 0.6 * totalReturn + 0.4 * stepScore;

    // 限制到 [-1, 1]，避免极端值
    const combined = Math.max(-1, Math.min(1, combinedRaw));

    // 4. 映射到概率
    const upProbability = (combined + 1) / 2;      // combined=-1 -> 0, combined=1 -> 1
    const downProbability = 1 - upProbability;
    const confidence = Math.abs(combined);         // 趋势强度

    // 5. 给一个方向标签
    const threshold = 0.2; // 趋势强度阈值，可调
    let direction: TrendDirection = OUTCOMES_ENUM.Up;
    if (confidence >= threshold) {
        direction = combined > 0 ? OUTCOMES_ENUM.Up : OUTCOMES_ENUM.Down;
    }

    return {
        direction,
        upProbability,
        downProbability,
        confidence
    };
}

/**
 * 计算衰减因子：随着 y 坐标的减小，x 坐标要减小得越来越快
 * - 使用「线性 + 幂函数」混合，让开头有一定斜率、越到结尾越陡
 * @param range - 二维数组，range[0] 是 x 轴范围 [x1, x2]，range[1] 是 y 轴范围 [y1, y2]（不要求前小后大）
 * @param y - 输入的 y 坐标值
 * @param power - 幂指数，默认 3；数值越大，越靠近 y 最小值时 x 衰减越快
 * @param mix - 线性与幂函数的混合比例，默认 0.3；越大，前半段越接近线性、下降不至于太慢
 * @returns 计算出的 x 坐标值
 */
export const calcAttenuationFactor = (range: number[][], y: number, power: number = 2, mix: number = 0.8) => {
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

    // 设计成：y 从大到小（1 -> 0），x 从大到小且越到后面减得越快
    // 使用线性与幂函数的混合：
    //   baseLinear = yNormalized                    （整体平滑）
    //   basePower  = 1 - (1 - yNormalized)^power   （结尾更陡）
    //   xNormalized = mix * baseLinear + (1 - mix) * basePower
    // 这样：
    // - 保证开头不会太平（有线性部分支撑斜率）
    // - 越靠近 yMin，幂函数贡献越大，下降更快
    const baseLinear = yNormalized;
    const basePower = 1 - Math.pow(1 - yNormalized, power);
    const xNormalized = mix * baseLinear + (1 - mix) * basePower;

    // 将归一化的 x 映射回实际范围
    const x = xMin + (xMax - xMin) * xNormalized;

    return x;
}


export const calcDiffBeatPrice = (price: string | number, priceToBeat: string | number, diffBeatPriceFactor: number[], distance: number) => {
    const globalConfig = getGlobalConfig();
    const { attenuationFactor, startBefore } = globalConfig.stratgegy;
    const timeBasedRatio = calcAttenuationFactor([diffBeatPriceFactor.reverse(), [0, startBefore]], distance, attenuationFactor[0], attenuationFactor[1]);

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

/**
 * 最后阶段（例如还剩 5 分钟）决策输入参数
 * - ticks: 当前这一局内的历史价格 tick（建议至少覆盖最近 8~10 分钟）
 * - timeToExpiryMs: 距离本局结束还剩的毫秒数
 * - priceToBeat: 本局开局价（到期时价格相对它的高/低决定输赢）
 * - upPayout/downPayout: 下注成功时的赔率（如 1.9 表示押 1 赢 0.9，拿回 1.9）
 */
export interface LastPeriodDecisionInput {
    ticks: PriceTickPoint[];
    timeToExpiryMs: number;
    priceToBeat: number;
    upPayout?: number;
    downPayout?: number;
}

/**
 * 决策过程中的一些可调阈值
 * - minEdge: 估计胜率相对盈亏平衡胜率的最小优势（比如 0.05 代表至少高 5%）
 * - minProbability: 建议下注时，方向的最小胜率（比如至少 0.55）
 * - minProbabilityGap: 两个方向胜率的最小差值（例如 0.05）
 * - strongProbabilityGap: 若概率优势达到这个值，可以在趋势不明显时也建议下注
 */
export interface LastPeriodDecisionThresholds {
    minEdge?: number;
    minProbability?: number;
    minProbabilityGap?: number;
    strongProbabilityGap?: number;
}

/**
 * 最后阶段决策结果
 * - recommendation: 建议押 Up、Down，或 null 表示不建议下注
 * - reason: 简要原因标签（便于上层记录日志或调参）
 * - upWinProbability/downWinProbability: 基于 GBM 模型估计的终值胜率
 * - fairUpProbability/fairDownProbability: 根据赔率算出的盈亏平衡胜率
 * - edgeUp/edgeDown: 相对于盈亏平衡胜率的优势（>0 代表有正期望）
 * - trend: 基于整段 prices 估计出的趋势信息
 */
export interface LastPeriodDecisionResult {
    recommendation: OUTCOMES_ENUM | null;
    reason: string;
    upWinProbability: number;
    downWinProbability: number;
    fairUpProbability: number;
    fairDownProbability: number;
    edgeUp: number;
    edgeDown: number;
    trend: TrendResult;
}

/**
 * 在最后一段时间内（例如最后 5 分钟），
 * 基于：
 *   - GBM 终值概率（calcBreakoutProbabilityFromTicks）
 *   - 赔率（upPayout / downPayout）
 *   - 趋势信息（calcTrend）
 * 给出一个「是否下注 / 下注 Up 还是 Down」的建议。
 *
 * 注意：
 * - 这里只做纯「统计 + 简单风控阈值」的计算，不涉及具体下单逻辑和金额控制。
 * - 上层可以根据返回的 reason / edge / trend 再叠加自己的风控规则。
 */
export const analyzeLastPeriodDecision = (
    input: LastPeriodDecisionInput,
    thresholds: LastPeriodDecisionThresholds = {
        minEdge: 0.1,
        minProbability: 0.90,
        minProbabilityGap: 0.60,
        strongProbabilityGap: 0.80,
    }
): LastPeriodDecisionResult => {
    const { ticks, timeToExpiryMs, priceToBeat } = input;
    const globalConfig = getGlobalConfig();

    // 1. 先用 GBM 模型估计终值高/低于 priceToBeat 的概率
    const breakout = calcBreakoutProbabilityFromTicks(
        ticks,
        timeToExpiryMs,
        priceToBeat
    );
    const { upBreakProbability, downBreakProbability } = breakout;

    // 2. 计算趋势信息（只使用 value 和时间）
    const trendTicks = ticks.map((t) => ({
        value: t.value,
        timestamp: toMs(t.timestamp),
    }));
    const trend = calcTrend(trendTicks);

    // 3. 根据赔率计算「盈亏平衡胜率」
    const defaultOdds = globalConfig?.stratgegy?.binaryOdds ?? 1.9; // 若配置中没有，则默认 1.9
    const upPayout = input.upPayout ?? defaultOdds;
    const downPayout = input.downPayout ?? defaultOdds;

    const fairUpProbability =
        upPayout > 1 ? 1 / upPayout : 0.5; // 赔率无效时退化为 0.5
    const fairDownProbability =
        downPayout > 1 ? 1 / downPayout : 0.5;

    const edgeUp = upBreakProbability - fairUpProbability;
    const edgeDown = downBreakProbability - fairDownProbability;

    // 4. 各种阈值设定（可通过 thresholds 或 config.json 调整）
    const minEdge = thresholds.minEdge ?? 0.05; // 至少有 5% 的正期望优势
    const minProbability = thresholds.minProbability ?? 0.55; // 胜率至少 55%
    const minProbabilityGap = thresholds.minProbabilityGap ?? 0.05; // 胜率差至少 5%
    const strongProbabilityGap =
        thresholds.strongProbabilityGap ?? 0.15; // 差 15% 以上视为强烈信号

    const trendThreshold =
        globalConfig?.stratgegy?.confidenceThreshold ?? 0.2;

    // 5. 基于概率和趋势综合给出建议
    let recommendation: OUTCOMES_ENUM | null = null;
    let reason = "no_clear_edge";

    // 5.1 概率更大的一方
    const probDirection =
        upBreakProbability >= downBreakProbability
            ? OUTCOMES_ENUM.Up
            : OUTCOMES_ENUM.Down;
    const probValue =
        probDirection === OUTCOMES_ENUM.Up
            ? upBreakProbability
            : downBreakProbability;
    const otherProbValue =
        probDirection === OUTCOMES_ENUM.Up
            ? downBreakProbability
            : upBreakProbability;
    const probGap = probValue - otherProbValue;

    const meetsProbLevel = probValue >= minProbability;
    const meetsGap = probGap >= minProbabilityGap;

    const edgeValue =
        probDirection === OUTCOMES_ENUM.Up ? edgeUp : edgeDown;
    const meetsEdge = edgeValue >= minEdge;

    const trendAligns =
        trend.direction === probDirection &&
        trend.confidence >= trendThreshold;

    if (meetsProbLevel && meetsGap && meetsEdge) {
        if (trendAligns || probGap >= strongProbabilityGap) {
            recommendation = probDirection;
            reason = trendAligns
                ? "probability_and_trend_align"
                : "probability_strong_edge";
        } else {
            reason = "probability_edge_but_trend_weak";
        }
    }

    return {
        recommendation,
        reason,
        upWinProbability: upBreakProbability,
        downWinProbability: downBreakProbability,
        fairUpProbability,
        fairDownProbability,
        edgeUp,
        edgeDown,
        trend,
    };
};

/**
 * 持仓管理：在已经买入之后，根据当前价格变化 & 剩余时间，
 * 决策是继续持有（hold）还是卖出（sell）。
 *
 * 设计目标：
 * - 复用 GBM 终值概率（calcBreakoutProbabilityFromTicks）
 * - 复用趋势分析（calcTrend）
 * - 让上层只需要传入：
 *   - 当前这一局的历史 tick
 *   - 剩余时间
 *   - 本局开局价（priceToBeat）
 *   - 当前持仓方向（positionOutcome：当时买的是 Up 还是 Down）
 *
 * 决策逻辑（与现有 monitorPriceChange 保持一致、但抽象成通用函数）：
 * - 若当前价格方向与持仓方向一致（in the money）：
 *   => 默认继续持有（action = "hold"）
 * - 若当前价格方向与持仓方向相反（out of the money）：
 *   => 计算「未来反转回到持仓方向」的概率：
 *      - 若 positionOutcome 为 Up，则用 upWinProbability = P(S_T >= priceToBeat)
 *      - 若 positionOutcome 为 Down，则用 downWinProbability = P(S_T <= priceToBeat)
 *   => 若这个反转胜率 >= holdProbabilityThreshold（默认为 config.stratgegy.breakProbabilityThreshold）：
 *      => 认为“存在翻盘可能”，继续持有（hold）
 *      否则 => 建议卖出（sell）
 */
export interface PositionExitDecisionInput {
    ticks: PriceTickPoint[];
    timeToExpiryMs: number;
    priceToBeat: number;
    positionOutcome: OUTCOMES_ENUM.Up | OUTCOMES_ENUM.Down;
}

export interface PositionExitDecisionThresholds {
    /**
     * 若当前价格方向与持仓方向相反，
     * 持有的最低「翻盘胜率」阈值。
     * 默认为 config.stratgegy.breakProbabilityThreshold（例如 0.8）
     */
    holdProbabilityThreshold?: number;
}

export interface PositionExitDecisionResult {
    action: TOKEN_ACTION_ENUM;
    reason: string;
    positionOutcome: OUTCOMES_ENUM;
    currentOutcome: OUTCOMES_ENUM;
    /**
     * 基于 GBM 模型的终值概率：
     * - upWinProbability = P(S_T >= priceToBeat)
     * - downWinProbability = P(S_T <= priceToBeat)
     */
    upWinProbability: number;
    downWinProbability: number;
    /**
     * positionOutcome 的胜率（若押 Up 则为 upWinProbability，押 Down 则为 downWinProbability）
     */
    winningProbability: number;
    losingProbability: number;
    stepsAhead: number;
    trend: TrendResult;
}

export const analyzePositionExitDecision = (
    input: PositionExitDecisionInput,
    thresholds: PositionExitDecisionThresholds = {}
): PositionExitDecisionResult => {
    const { ticks, timeToExpiryMs, priceToBeat, positionOutcome } = input;
    const globalConfig = getGlobalConfig();

    // 安全兜底：数据不足时直接建议持有，避免频繁抖动
    if (!ticks || ticks.length < 2 || timeToExpiryMs <= 0 || priceToBeat <= 0) {
        return {
            action: TOKEN_ACTION_ENUM.hold,
            reason: "insufficient_data",
            positionOutcome,
            currentOutcome: positionOutcome,
            upWinProbability: 0.5,
            downWinProbability: 0.5,
            winningProbability: 0.5,
            losingProbability: 0.5,
            stepsAhead: 0,
            trend: {
                direction: positionOutcome,
                upProbability: 0.5,
                downProbability: 0.5,
                confidence: 0,
            },
        };
    }

    const lastTick = ticks[ticks.length - 1];
    const lastPrice = lastTick.value;
    const currentOutcome =
        lastPrice >= priceToBeat ? OUTCOMES_ENUM.Up : OUTCOMES_ENUM.Down;

    // 1. 当前价格方向若与持仓方向一致 => 直接建议继续持有
    if (currentOutcome === positionOutcome) {
        const breakout = calcBreakoutProbabilityFromTicks(
            ticks,
            timeToExpiryMs,
            priceToBeat
        );
        const trendTicks = ticks.map((t) => ({
            value: t.value,
            timestamp: toMs(t.timestamp),
        }));

        const trend = calcTrend(trendTicks);

        const upWinProbability = breakout.upBreakProbability;
        const downWinProbability = breakout.downBreakProbability;
        const winningProbability =
            positionOutcome === OUTCOMES_ENUM.Up
                ? upWinProbability
                : downWinProbability;
        const losingProbability = 1 - winningProbability;

        return {
            action: TOKEN_ACTION_ENUM.hold,
            reason: "in_favor_currently",
            positionOutcome,
            currentOutcome,
            upWinProbability,
            downWinProbability,
            winningProbability,
            losingProbability,
            stepsAhead: breakout.stepsAhead,
            trend,
        };
    }

    // 2. 当前价格方向与持仓方向相反 => 判断“翻盘胜率”是否足够高
    const breakout = calcBreakoutProbabilityFromTicks(
        ticks,
        timeToExpiryMs,
        priceToBeat
    );
    const { upBreakProbability, downBreakProbability, stepsAhead } = breakout;

    const trendTicks = ticks.map((t) => ({
        value: t.value,
        timestamp: toMs(t.timestamp),
    }));
    const trend = calcTrend(trendTicks);

    const upWinProbability = upBreakProbability;
    const downWinProbability = downBreakProbability;
    const winningProbability =
        positionOutcome === OUTCOMES_ENUM.Up
            ? upWinProbability
            : downWinProbability;
    const losingProbability = 1 - winningProbability;

    const defaultHoldThreshold =
        globalConfig?.stratgegy?.breakProbabilityThreshold ?? 0.8;
    const holdProbabilityThreshold =
        thresholds.holdProbabilityThreshold ?? defaultHoldThreshold;

    let action: TOKEN_ACTION_ENUM = TOKEN_ACTION_ENUM.sell;
    let reason = "low_flip_probability";

    if (winningProbability >= holdProbabilityThreshold) {
        action = TOKEN_ACTION_ENUM.hold;
        reason = "high_flip_probability";
    }

    return {
        action,
        reason,
        positionOutcome,
        currentOutcome,
        upWinProbability,
        downWinProbability,
        winningProbability,
        losingProbability,
        stepsAhead,
        trend,
    };
};
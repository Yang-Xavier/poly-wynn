interface PricePoint {
    value: number;
    timestamp: number;
}

interface TailSweepParams {
    priceData: PricePoint[];
    /**
     * 距离到期剩余时间（毫秒）
     */
    expiryTime: number;
    upBestAsk: number;
    downBestAsk: number;
    targetPrice: number;
}

interface MomentumFactor {
    shortMomentum: number;
    mediumMomentum: number;
    acceleration: number;
    isAccelerating: boolean;
    momentumScore: number;
}

interface TailProbabilityResult {
    probUp: number;
    probDown: number;
    momentumScore: number;
    timeDecayFactor: number;
}

interface MarketProbabilities {
    upImplied: number;
    downImplied: number;
    marketVig: number;
    upOdds: number;
    downOdds: number;
}

type BetSide = 'UP' | 'DOWN' | null;

interface TailDecisionMetrics {
    currentPrice: number;
    targetPrice: number;
    priceDifference: string;
    timeRemaining: string | number;
    tailProbUp: string;
    marketProbUp: string;
    valueEdgeUp: string;
    valueEdgeDown: string;
    momentumScore: string;
    timeDecayFactor: string;
    marketVig: string;
}

interface TailDecision {
    decision: string;
    confidence: string | number;
    betSide: BetSide;
    betAmount: string | number;
    estimatedWinRate: string;
    rationale: string[];
    metrics: TailDecisionMetrics | { timeRemaining: string | number };
    reason?: string;
}

interface TailOpportunity {
    timestamp: number;
    decision: string;
    confidence: string | number;
    betAmount: string | number;
    metrics: TailDecisionMetrics | { timeRemaining: string | number };
}

interface TailMonitorStats {
    totalOpportunities: number;
    buySignals: number;
    smallBets: number;
    monitoringDuration: string;
    opportunityRate: number;
    avgConfidence: string;
}

/**
 * 尾盘扫货策略 - 专门针对最后5分钟
 * 核心逻辑：更激进的价值发现，考虑时间衰减效应
 */
export class TailSweepStrategy {
    private priceData: PricePoint[];
    private expiryTime: number;
    private upBestAsk: number;
    private downBestAsk: number;
    private targetPrice: number;
    private timeRemaining: number;

    constructor(params: TailSweepParams) {
        this.priceData = params.priceData;
        this.expiryTime = params.expiryTime;
        this.upBestAsk = params.upBestAsk;
        this.downBestAsk = params.downBestAsk;
        this.targetPrice = params.targetPrice;
        // expiryTime 传入的就是“还剩多少时间到期”（毫秒），这里转成分钟
        this.timeRemaining = Math.max(0, this.expiryTime / 60000); // 分钟
    }
    
    /**
     * 计算尾盘动量因子
     * 最后几分钟的价格动量非常重要
     */
    calculateMomentumFactor(): MomentumFactor {
        if (this.priceData.length < 10) {
            return {
                shortMomentum: 0,
                mediumMomentum: 0,
                acceleration: 0,
                isAccelerating: false,
                momentumScore: 0
            };
        }
        
        const recentPrices = this.priceData.slice(-10);
        const firstPrice = recentPrices[0].value;
        const lastPrice = recentPrices[recentPrices.length - 1].value;
        const midPrice = recentPrices[Math.floor(recentPrices.length / 2)].value;
        
        // 短期动量（最近几个点）
        const shortMomentum = (lastPrice - recentPrices[recentPrices.length - 3].value) / 
                            recentPrices[recentPrices.length - 3].value;
        
        // 中期动量（整个时间段）
        const mediumMomentum = (lastPrice - firstPrice) / firstPrice;
        
        // 加速度（动量变化率）
        const firstHalfMomentum = (midPrice - firstPrice) / firstPrice;
        const secondHalfMomentum = (lastPrice - midPrice) / midPrice;
        const acceleration = secondHalfMomentum - firstHalfMomentum;
        
        return {
            shortMomentum,
            mediumMomentum,
            acceleration,
            isAccelerating: acceleration > 0,
            momentumScore: shortMomentum * 0.6 + mediumMomentum * 0.4
        };
    }
    
    /**
     * 计算时间衰减调整因子
     * 尾盘的时间价值衰减很快，需要调整概率
     */
    calculateTimeDecayFactor(): number {
        const remainingMinutes = this.timeRemaining;
        
        // 最后5分钟的时间衰减曲线
        // 越接近结束，波动率影响越小，当前价格影响越大
        if (remainingMinutes > 5) return 1.0;
        
        // 非线性衰减：最后1分钟衰减最快
        if (remainingMinutes <= 1) {
            return 0.3; // 最后1分钟，时间价值只剩30%
        } else if (remainingMinutes <= 2) {
            return 0.5; // 最后2分钟
        } else if (remainingMinutes <= 3) {
            return 0.7; // 最后3分钟
        } else {
            return 0.85; // 最后4-5分钟
        }
    }
    
    /**
     * 计算尾盘理论概率
     * 基于当前价格和动量的简化模型
     */
    calculateTailProbability(): TailProbabilityResult {
        const currentPrice = this.getCurrentPrice();
        const momentum = this.calculateMomentumFactor();
        const timeDecay = this.calculateTimeDecayFactor();
        
        // 基础概率：基于当前价格与目标价格的差距
        const priceGap = (currentPrice - this.targetPrice) / this.targetPrice;
        let baseProbUp = 0.5 + Math.tanh(priceGap * 5) * 0.4; // 使用tanh函数平滑
        
        // 动量调整
        if (momentum.momentumScore > 0.01) {
            // 上涨动量增强上涨概率
            baseProbUp += momentum.momentumScore * 2;
        } else if (momentum.momentumScore < -0.01) {
            // 下跌动量减弱上涨概率
            baseProbUp += momentum.momentumScore * 2;
        }
        
        // 加速度调整
        if (momentum.isAccelerating && priceGap > 0) {
            baseProbUp += 0.1; // 加速上涨
        } else if (!momentum.isAccelerating && priceGap < 0) {
            baseProbUp -= 0.1; // 加速下跌
        }
        
        // 时间衰减调整
        // 剩余时间越少，当前价格的决定性越强
        const timeAdjustedProb = baseProbUp * timeDecay + 
                                (currentPrice > this.targetPrice ? 1 : 0) * (1 - timeDecay) * 0.5;
        
        // 限制在合理范围
        const finalProbUp = Math.max(0.1, Math.min(0.9, timeAdjustedProb));
        const finalProbDown = 1 - finalProbUp;
        
        return {
            probUp: finalProbUp,
            probDown: finalProbDown,
            momentumScore: momentum.momentumScore,
            timeDecayFactor: timeDecay
        };
    }
    
    /**
     * 获取当前价格
     */
    getCurrentPrice(): number {
        if (this.priceData.length === 0) return this.targetPrice;
        return this.priceData[this.priceData.length - 1].value;
    }
    
    /**
     * 计算市场隐含概率（归一化）
     */
    getMarketProbabilities(): MarketProbabilities {
        const total = this.upBestAsk + this.downBestAsk;
        return {
            upImplied: this.upBestAsk / total,
            downImplied: this.downBestAsk / total,
            marketVig: total - 1,
            upOdds: 1 / this.upBestAsk,
            downOdds: 1 / this.downBestAsk
        };
    }
    
    /**
     * 尾盘凯利公式（更激进）
     */
    tailKellyCriterion(odds: number, probability: number, timeRemaining: number): number {
        const b = odds - 1;
        const p = probability;
        const q = 1 - p;
        
        if (b <= 0) return 0;
        
        const rawKelly = (b * p - q) / b;
        
        // 尾盘调整：时间越少，下注越保守
        let timeFactor;
        if (timeRemaining <= 1) {
            timeFactor = 0.3; // 最后1分钟非常保守
        } else if (timeRemaining <= 2) {
            timeFactor = 0.5;
        } else if (timeRemaining <= 3) {
            timeFactor = 0.7;
        } else {
            timeFactor = 0.9; // 最后4-5分钟相对激进
        }
        
        // 尾盘可以使用更激进的仓位（因为机会少）
        const tailAdjusted = rawKelly * 0.8 * timeFactor; // 使用80%凯利
        
        // 尾盘最大仓位限制
        return Math.min(0.2, Math.max(0, tailAdjusted));
    }
    
    /**
     * 计算价值优势（尾盘专用）
     */
    calculateTailValueEdge(tailProb: number, marketProb: number): number {
        const rawEdge = tailProb - marketProb;
        
        // 尾盘调整：对于小的价值优势也值得考虑
        if (Math.abs(rawEdge) < 0.01) {
            return rawEdge; // 太小忽略
        }
        
        // 放大明显的优势
        return rawEdge * 1.5;
    }
    
    /**
     * 尾盘扫货决策逻辑
     */
    generateSweepDecision(): TailDecision {
        const currentPrice = this.getCurrentPrice();
        const priceDiffPercent = ((currentPrice - this.targetPrice) / this.targetPrice * 100).toFixed(2);
        
        // 2. 计算尾盘理论概率
        const tailProb = this.calculateTailProbability();
        
        // 3. 市场数据
        const market = this.getMarketProbabilities();
        
        // 4. 计算价值优势
        const valueEdgeUp = this.calculateTailValueEdge(tailProb.probUp, market.upImplied);
        const valueEdgeDown = this.calculateTailValueEdge(tailProb.probDown, market.downImplied);
        
        // 5. 尾盘决策阈值（比正常低）
        const MIN_EDGE = 0.015; // 1.5%优势即可
        const MIN_CONFIDENCE = 0.2;
        
        // 6. 动量确认
        const momentum = this.calculateMomentumFactor();
        const hasStrongMomentum = Math.abs(momentum.momentumScore) > 0.02;
        
        // 7. 尾盘决策逻辑
        let decision = 'HOLD';
        let confidence = 0;
        let betSide: BetSide = null;
        let betAmount = 0;
        const rationale: string[] = [];
        
        // 检查UP机会
        if (valueEdgeUp > MIN_EDGE) {
            const kellyAmount = this.tailKellyCriterion(market.upOdds, tailProb.probUp, this.timeRemaining);
            
            // 动量确认：如果动量支持，增强信心
            let momentumBonus = 1.0;
            if (hasStrongMomentum && momentum.momentumScore > 0) {
                momentumBonus = 1.3;
                rationale.push('动量确认：有上涨动量');
            }
            
            confidence = Math.min(0.95, valueEdgeUp * 10 * momentumBonus);
            
            if (confidence > MIN_CONFIDENCE && kellyAmount > 0.01) {
                decision = 'BUY_UP';
                betSide = 'UP';
                betAmount = kellyAmount;
                rationale.push(`尾盘价值优势: +${(valueEdgeUp*100).toFixed(2)}%`);
                rationale.push(`动量得分: ${(momentum.momentumScore*100).toFixed(2)}%`);
            }
        }
        
        // 检查DOWN机会
        if (valueEdgeDown > MIN_EDGE && decision === 'HOLD') {
            const kellyAmount = this.tailKellyCriterion(market.downOdds, tailProb.probDown, this.timeRemaining);
            
            let momentumBonus = 1.0;
            if (hasStrongMomentum && momentum.momentumScore < 0) {
                momentumBonus = 1.3;
                rationale.push('动量确认：有下跌动量');
            }
            
            confidence = Math.min(0.95, valueEdgeDown * 10 * momentumBonus);
            
            if (confidence > MIN_CONFIDENCE && kellyAmount > 0.01) {
                decision = 'BUY_DOWN';
                betSide = 'DOWN';
                betAmount = kellyAmount;
                rationale.push(`尾盘价值优势: +${(valueEdgeDown*100).toFixed(2)}%`);
                rationale.push(`动量得分: ${(momentum.momentumScore*100).toFixed(2)}%`);
            }
        }
        
        // 8. 特殊尾盘策略：价格极端偏离
        if (decision === 'HOLD' && Math.abs(parseFloat(priceDiffPercent)) > 2) {
            // 价格偏离超过2%，考虑反向交易
            const extremeFactor = Math.abs(parseFloat(priceDiffPercent)) / 5; // 0-1因子
            
            if (currentPrice > this.targetPrice * 1.02) {
                // 价格明显高于目标，考虑买DOWN（均值回归）
                const meanReversionProb = Math.max(0.3, 0.5 - extremeFactor * 0.3);
                const valueEdge = meanReversionProb - market.downImplied;
                
                if (valueEdge > 0.02) {
                    decision = 'BUY_DOWN';
                    betSide = 'DOWN';
                    betAmount = Math.min(0.15, extremeFactor * 0.1);
                    confidence = 0.4 + extremeFactor * 0.3;
                    rationale.push(`极端价格策略：当前偏高${priceDiffPercent}%，期待均值回归`);
                }
            } else if (currentPrice < this.targetPrice * 0.98) {
                // 价格明显低于目标，考虑买UP
                const meanReversionProb = Math.max(0.3, 0.5 + extremeFactor * 0.3);
                const valueEdge = meanReversionProb - market.upImplied;
                
                if (valueEdge > 0.02) {
                    decision = 'BUY_UP';
                    betSide = 'UP';
                    betAmount = Math.min(0.15, extremeFactor * 0.1);
                    confidence = 0.4 + extremeFactor * 0.3;
                    rationale.push(`极端价格策略：当前偏低${priceDiffPercent}%，期待均值回归`);
                }
            }
        }
        
        // 10. 生成最终输出
        const estimatedWinRate = betSide === 'UP' ? 
            (tailProb.probUp * 100).toFixed(1) + '%' :
            (tailProb.probDown * 100).toFixed(1) + '%';
        
        return {
            decision,
            confidence: confidence.toFixed(2),
            betSide,
            betAmount: betAmount.toFixed(4),
            estimatedWinRate,
            rationale,
            metrics: {
                currentPrice,
                targetPrice: this.targetPrice,
                priceDifference: priceDiffPercent + '%',
                timeRemaining: this.timeRemaining.toFixed(2) + '分钟',
                tailProbUp: (tailProb.probUp * 100).toFixed(1) + '%',
                marketProbUp: (market.upImplied * 100).toFixed(1) + '%',
                valueEdgeUp: (valueEdgeUp * 100).toFixed(2) + '%',
                valueEdgeDown: (valueEdgeDown * 100).toFixed(2) + '%',
                momentumScore: (momentum.momentumScore * 100).toFixed(2) + '%',
                timeDecayFactor: tailProb.timeDecayFactor.toFixed(2),
                marketVig: (market.marketVig * 100).toFixed(2) + '%'
            }
        };
    }
}

/**
 * 尾盘扫货策略入口函数
 */
export function tailSweepStrategy(params: TailSweepParams): TailDecision {
    const strategy = new TailSweepStrategy(params);
    return strategy.generateSweepDecision();
}

/**
 * 对外暴露的交易决策函数（供其他模块调用）
 */
export function makeTradingDecision(params: TailSweepParams): TailDecision {
    return tailSweepStrategy(params);
}

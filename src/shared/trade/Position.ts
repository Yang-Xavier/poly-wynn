import { TRADE_ACTION_ENUM, OUTCOMES_ENUM } from "@shared/constants";

/**
 * 交易记录接口
 */
export interface TradeRecord {
  action: TRADE_ACTION_ENUM;
  outcome: OUTCOMES_ENUM;
  amount: number;
  size: number;
  price: number;
  fee: number;
  timestamp: number;
}

/**
 * 持仓信息接口
 */
export interface PositionInfo {
  outcome: OUTCOMES_ENUM | undefined;
  amount: number; // 总金额（持仓成本）
  size: number; // 持仓数量
  price: number; // 平均持仓价格
  totalFee: number; // 总手续费（统一换算成 amount）
}

/**
 * 持仓管理类
 */
export class Position {
  private trades: TradeRecord[] = [];
  // 持仓信息
  private position: PositionInfo = {
    outcome: undefined,
    amount: 0,
    size: 0,
    price: 0,
    totalFee: 0,
  };

  /**
   * 设置持仓信息
   * @param position 持仓信息
   */
  setPosition(position: PositionInfo): void {
    this.position = { ...position };
  }

  /**
   * 添加交易记录并更新持仓
   * @param action 交易动作：'buy' 买入，'sell' 卖出
   * @param size 交易数量
   * @param price 交易价格
   * @param outcome outcome类型
   */
  addTrade({
    action,
    size,
    amount,
    price,
    outcome,
    fee,
  }: {
    action: TRADE_ACTION_ENUM;
    amount: number;
    size: number;
    price: number;
    outcome: OUTCOMES_ENUM;
    fee: number;
  }): void {
    if (size <= 0 || price <= 0) {
      throw new Error("交易数量和价格必须大于0");
    }

    // 记录交易（记录原始数据）
    const trade: TradeRecord = {
      fee,
      action,
      amount,
      size,
      price,
      outcome,
      timestamp: Date.now(),
    };
    this.trades.push(trade);

    // 更新总手续费
    this.position.totalFee += fee;
    this.position.outcome = outcome;

    // 更新持仓
    if (action === TRADE_ACTION_ENUM.buy) {
      // 买入：增加持仓
      const totalCost = this.position.amount + amount;
      this.position.size += size;
      this.position.amount = totalCost;
      // 重新计算平均价格
      this.position.price = this.position.size > 0 ? this.position.amount / this.position.size : 0;
    } else if (action === TRADE_ACTION_ENUM.sell) {
      // 卖出：减少持仓
      if (this.position.size < size) {
        throw new Error(`持仓不足，当前持仓: ${this.position.size}，尝试卖出: ${size}`);
      }
      // 使用平均成本法计算减少的成本
      const costToReduce = (this.position.amount / this.position.size) * size;
      this.position.size -= size;
      this.position.amount -= costToReduce;
      // 重新计算平均价格（如果还有持仓）
      this.position.price = this.position.size > 0 ? this.position.amount / this.position.size : 0;
    }
  }

  /**
   * 获取持仓信息
   * @returns 持仓信息对象
   */
  getPosition(): PositionInfo {
    return { ...this.position };
  }

  /**
   * 获取所有交易记录
   * @returns 交易记录数组
   */
  getTrades(): TradeRecord[] {
    return [...this.trades]; // 返回副本，防止外部修改
  }

  /**
   * 重置持仓（清空所有数据）
   */
  reset(): void {
    this.trades = [];
    this.position = {
      outcome: undefined,
      amount: 0,
      size: 0,
      price: 0,
      totalFee: 0,
    };
  }
}

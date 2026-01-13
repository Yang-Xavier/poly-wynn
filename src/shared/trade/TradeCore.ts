import { Side } from "@polymarket/clob-client";
import ClobApi from "@shared/api/clobApi";
import { OUTCOMES_ENUM, TRADE_ACTION_ENUM } from "@shared/constants";
import { TCreds } from "@shared/encryptConfig";
import { UserWs } from "@shared/ws/UserWs";

export type TBriefOrder = {
  size: number;
  price: number;
  amount: number;
  orderId: string;
  outcome: OUTCOMES_ENUM;
  assetId: string;
  status: string;
  fee: number;
  timestamp: number;
};

export default class TradeCore {
  private clobApi: ClobApi;
  private userWs: UserWs;
  private logInfo: (message: string) => void;

  constructor({
    privKey,
    signatureType = 1,
    clobCreds,
    funderAddress,
    userWs,
    logInfo,
  }: {
    privKey: string;
    signatureType: number;
    clobCreds: TCreds;
    funderAddress: string;
    userWs: UserWs;
    logInfo: (message: string) => void;
  }) {
    this.clobApi = new ClobApi({
      privKey,
      signatureType,
      clobCreds,
      funderAddress,
    });
    this.userWs = userWs;
    this.logInfo = logInfo;
  }

  /**
   * 计算基础手续费率
   * @param price 交易价格
   * @returns 基础手续费率
   */
  private calculateBaseFeeRate(price: number): number {
    return 0.25 * Math.pow(price * (1 - price), 2);
  }

  /**
   * 计算手续费和实际交易数据
   * @param action 交易动作
   * @param size 交易数量
   * @param price 交易价格
   * @param baseFeeRate 基础手续费率
   * @returns 手续费金额、实际size、实际amount
   */
  private calculateFeeAndActuals(
    action: TRADE_ACTION_ENUM,
    size: number,
    price: number
  ): {
    feeAmount: number;
    actualSize: number;
    actualAmount: number;
  } {
    // 计算基础手续费率
    const baseFeeRate = this.calculateBaseFeeRate(price);

    let feeAmount: number;
    let actualSize: number; // 扣减手续费后的实际 size
    let actualAmount: number; // 扣减手续费后的实际 amount

    if (action === TRADE_ACTION_ENUM.buy) {
      // buy 方向：收取 size，手续费 = baseFeeRate * size
      // 实际得到的 size = size * (1 - baseFeeRate)
      actualSize = size * (1 - baseFeeRate);
      // 手续费换算成 amount = baseFeeRate * size * price
      feeAmount = baseFeeRate * size * price;
      // 实际成本 amount = actualSize * price
      actualAmount = actualSize * price;
    } else {
      // sell 方向：收取 size*price 得到的 amount，手续费 = baseFeeRate * amount
      const tradeAmount = size * price;
      feeAmount = baseFeeRate * tradeAmount;
      // 实际得到的 amount = tradeAmount * (1 - baseFeeRate)
      actualAmount = tradeAmount * (1 - baseFeeRate);
      // sell 时 size 不变（卖出多少就是多少）
      actualSize = size;
    }

    return {
      feeAmount,
      actualSize,
      actualAmount,
    };
  }

  private async waitForOrderMatched({
    orderId,
    timeout = 5 * 1000,
  }: {
    orderId: string;
    timeout?: number;
  }): Promise<TBriefOrder | null> {
    let resolved = false;
    this.logInfo(`[waitForOrderMatched] 等待订单成交...${orderId}`);

    return new Promise((resolve) => {
      const timer = setTimeout(async () => {
        if (resolved) return;
        this.logInfo(`[waitForOrderMatched] 监听推送订单成交超时, API查询...`);
        const resp = await this.clobApi.getOrder({ orderId });
        const { feeAmount, actualSize, actualAmount } = this.calculateFeeAndActuals(
          TRADE_ACTION_ENUM.buy,
          Number(resp.size_matched),
          Number(resp.price)
        );
        const order: TBriefOrder = {
          size: actualSize,
          amount: actualAmount,
          price: Number(resp.price),
          orderId: resp.id,
          assetId: resp.asset_id,
          outcome: resp.outcome as OUTCOMES_ENUM,
          fee: feeAmount,
          status: resp.status,
          timestamp: resp.created_at,
        };
        this.logInfo(`[waitForOrderMatched] 订单成交...${JSON.stringify(order)}`);
        resolve(order);
        clearTimeout(timer);
      }, timeout);

      this.userWs.onUserTrade((trade) => {
        if (resolved) return;
        this.logInfo(`[waitForOrderMatched] 监听到有订单推送...${JSON.stringify(trade)}`);
        if (trade.taker_order_id === orderId) {
          const sizeMatched = trade.maker_orders.reduce(
            (acc, curr) => acc + Number(curr.matched_amount),
            0
          );
          const { feeAmount, actualSize, actualAmount } = this.calculateFeeAndActuals(
            TRADE_ACTION_ENUM.buy,
            sizeMatched,
            Number(trade.price)
          );

          const order: TBriefOrder = {
            size: actualSize,
            fee: feeAmount,
            amount: actualAmount,
            price: Number(trade.price),
            orderId: trade.taker_order_id,
            assetId: trade.asset_id,
            outcome: trade.outcome as OUTCOMES_ENUM,
            status: "MATCHED",
            timestamp: Number(trade.timestamp),
          };
          resolved = true;
          resolve(order);
          this.logInfo(`[waitForOrderMatched] 订单成交...${JSON.stringify(order)}`);
          timer && clearTimeout(timer);
        }
      });
    });
  }

  async marketBuy({ tokenId, amount, price }: { tokenId: string; amount: number; price: number }) {
    const resp = await this.clobApi.postMarketOrder({
      tokenId,
      side: Side.BUY,
      amount,
      price,
    });
    return resp;
  }

  async marketSell({ tokenId, size, price }: { tokenId: string; size: number; price: number }) {
    const resp = await this.clobApi.postMarketOrder({
      tokenId,
      side: Side.SELL,
      amount: size,
      price,
    });
    return resp;
  }

  async marketBuyAndWaitFill({
    tokenId,
    price,
    amount,
  }: {
    tokenId: string;
    price: number;
    amount: number;
  }) {
    try {
      this.logInfo(
        `[🙏marketBuyAndWaitFill] 市场买入...${JSON.stringify({ tokenId, price, amount })}`
      );
      const resp = await this.marketBuy({
        tokenId,
        price,
        amount,
      });
      this.logInfo(`[🙏marketBuyAndWaitFill] 市场买入响应...${JSON.stringify(resp)}`);
      if (resp.orderID) {
        const order = await this.waitForOrderMatched({
          orderId: resp.orderID,
          timeout: 5 * 1000,
        });
        this.logInfo(`[🙏marketBuyAndWaitFill] 市场买入订单成交...`);
        return order;
      }
    } catch (error) {
      this.logInfo(`[🙏marketBuyAndWaitFill] 市场买入失败: ${error}`);
    }

    return null;
  }

  async marketSellAndWaitFill({
    tokenId,
    price,
    size,
  }: {
    tokenId: string;
    price: number;
    size: number;
  }) {
    try {
      this.logInfo(
        `[🙏marketSellAndWaitFill] 市场卖出...${JSON.stringify({ tokenId, price, size })}`
      );
      const resp = await this.marketSell({
        tokenId,
        price,
        size,
      });
      this.logInfo(`[🙏marketSellAndWaitFill] 市场卖出响应...${JSON.stringify(resp)}`);

      if (resp.orderID) {
        const order = await this.waitForOrderMatched({
          orderId: resp.orderID,
          timeout: 5 * 1000,
        });
        this.logInfo(`[🙏marketSellAndWaitFill] 市场卖出订单成交...`);
        return order;
      }
    } catch (error) {
      this.logInfo(`[🙏marketSellAndWaitFill] 市场卖出失败: ${error}`);
    }
    return null;
  }

  setUserWs(userWs: UserWs) {
    this.userWs = userWs;
  }
}

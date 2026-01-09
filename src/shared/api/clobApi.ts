import { Wallet } from "@ethersproject/wallet";
import { ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { CLOB_HOST, FUNDER_ADDRESS } from "@shared/constants";
import { getEncryptedConfig } from "@shared/encryptConfig";
import { IOrderData } from "@typings/orderData";

let clobClient;

export default {
  init: async () => {
    const { clobCreds, privKey } = getEncryptedConfig();
    const signatureType = 1;
    const signer = new Wallet(privKey);
    clobClient = new ClobClient(CLOB_HOST, 137, signer, clobCreds, signatureType, FUNDER_ADDRESS);
    await clobClient.getOk();
  },
  async postOrder({
    tokenID,
    side,
    price,
    size,
    tickSize = "0.01",
    negRisk = false,
    orderType = OrderType.FAK,
  }: {
    tokenID: string;
    side: Side;
    price: number;
    size: number;
    tickSize?: string;
    negRisk?: boolean;
    orderType?: OrderType;
  }) {
    try {
      const resp = await clobClient!.createAndPostOrder(
        {
          tokenID,
          side,
          price: Number(price),
          size: Number(size),
        },
        { tickSize: tickSize as any, negRisk },
        orderType as any
      );
      return resp;
    } catch (err) {
      throw err;
    }
  },
  async postMarketOrder({
    tokenID,
    side, // Side.BUY or Side.SELL
    amount, // 金额
    tickSize = "0.01",
    negRisk = false,
    orderType = OrderType.FAK, // 默认FAK
    price,
  }: {
    tokenID: string;
    side: Side;
    amount: number;
    tickSize?: string;
    negRisk?: boolean;
    orderType?: OrderType;
    price?: number;
  }) {
    try {
      const resp = await clobClient!.createAndPostMarketOrder(
        {
          tokenID,
          side,
          price,
          amount: Number(amount),
        },
        // negRisk 表示是否开启负风险报价（Negative Risk Quotes）。
        // "风险溢价为负"指：你愿意在成交时为概率较小（赔率更高）的结果买入方承担部分风险，也就是让市场流动性更充裕，用户能以更优价格成交（即挂单价优于理论价值）；此时订单撮合时优先级会有变化，并可能触发特殊风控机制。
        // tickSize 是指支持的最小价格变动单位（如0.01表示价格只能是0.01、0.02、…等倍数）；下单时你指定价格必须是tickSize的整数倍。
        { tickSize: tickSize as any, negRisk },
        orderType as any
      );
      return resp;
    } catch (err) {
      throw err;
    }
  },
  async getOrder({ orderId }: { orderId: string }): Promise<IOrderData | null> {
    try {
      const resp = await clobClient!.getOrder(orderId);
      return resp;
    } catch (err) {
      throw err;
    }
  },
};

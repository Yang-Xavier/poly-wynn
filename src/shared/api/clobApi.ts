import { Wallet } from "@ethersproject/wallet";
import { ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { CLOB_HOST } from "@shared/constants";
import { TCreds } from "@shared/encryptConfig";
import { IOrderData } from "@typings/orderData";

export default class ClobApi {
  private clobClient: ClobClient;

  constructor({
    privKey,
    signatureType = 1,
    clobCreds,
    funderAddress,
  }: {
    privKey: string;
    signatureType: number;
    clobCreds: TCreds;
    funderAddress: string;
  }) {
    this.clobClient = new ClobClient(
      CLOB_HOST,
      137,
      new Wallet(privKey),
      clobCreds,
      signatureType,
      funderAddress
    );
  }
  async postLimitOrder({
    tokenId,
    side,
    price,
    size,
  }: {
    tokenId: string;
    side: Side;
    price: number;
    size: number;
    orderType?: OrderType;
  }) {
    const resp = await this.clobClient.createAndPostOrder(
      {
        side,
        tokenID: tokenId,
        price: Number(price),
        size: Number(size),
      },
      { tickSize: "0.01", negRisk: false },
      OrderType.GTC
    );
    return resp;
  }

  async postMarketOrder({
    tokenId,
    side,
    amount,
    price,
  }: {
    tokenId: string;
    side: Side;
    amount: number;
    price?: number;
  }) {
    const resp = await this.clobClient.createAndPostMarketOrder(
      {
        tokenID: tokenId,
        side,
        price,
        amount: Number(amount),
      },
      // negRisk 表示是否开启负风险报价（Negative Risk Quotes）。
      // "风险溢价为负"指：你愿意在成交时为概率较小（赔率更高）的结果买入方承担部分风险，也就是让市场流动性更充裕，用户能以更优价格成交（即挂单价优于理论价值）；此时订单撮合时优先级会有变化，并可能触发特殊风控机制。
      // tickSize 是指支持的最小价格变动单位（如0.01表示价格只能是0.01、0.02、…等倍数）；下单时你指定价格必须是tickSize的整数倍。
      { tickSize: "0.01", negRisk: false },
      OrderType.FAK
    );
    return resp;
  }

  async getOrder({ orderId }: { orderId: string }): Promise<IOrderData | null> {
    const resp = await this.clobClient.getOrder(orderId);
    return resp;
  }

  async cancelOrder({ orderId }: { orderId: string }) {
    const resp = await this.clobClient.cancelOrder({ orderID: orderId });
    return resp;
  }
  
}

// npm install @polymarket/clob-client
// npm install ethers

import { ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import { awaitAxiosDataTo } from "../utils/awaitTo";
import Proxy from "@utils/Proxy";
import { logInfo } from "./logger";
import { getGlobalConfig, getKeyConfig } from "@utils/config";

// 订单簿价格档位
interface OrderLevel {
  price: string;  // 价格（字符串保持精度）
  size: string;   // 该价格档位的总数量
}

// OrderBook 响应类型
interface OrderBookSummary {
  market: string;           // Market 标识符
  asset_id: string;         // Asset 标识符
  timestamp: string;        // 订单簿快照时间戳
  hash: string;             // 订单簿状态哈希
  bids: OrderLevel[];       // 买单列表
  asks: OrderLevel[];       // 卖单列表
  min_order_size: string;   // 最小订单大小
  tick_size: string;        // 最小价格增量
  neg_risk: boolean;        // 是否启用负风险
}

type PolymarketOrderResult = {
  id: string;
  status: string;
  owner: string;
  maker_address: string;
  market: string;
  asset_id: string;
  side: string;
  original_size: string;
  size_matched: string;
  price: string;
  outcome: string;
  expiration: string;
  order_type: string;
  associate_trades: string[];
  created_at: number;
};
/*
PolymarketOrderResult 类型:
{
  id: '0x9d54bbb846143f0f454b3033e3fab0ec1e58c4cfa188f06ee1a666f0ebc2d2ec',
  status: 'MATCHED',
  owner: '29620a3f-ffbb-cf5e-521b-fdb3e88e4cc3',
  maker_address: '0xe10c61be54E4c25FB744113cbbaFF28123f5a107',
  market: '0x814677b7fbcb17cce79dffd2b189ea3d820a203a98ec0bb52d0d9dc3b79d4aa2',
  asset_id: '2718137133925501563002453238614134960382050283167537847205116466109971255702',
  side: 'SELL',
  original_size: '42',
  size_matched: '42',
  price: '0.03',
  outcome: 'Up',
  expiration: '0',
  order_type: 'FAK',
  associate_trades: [ 'cae64e81-1315-4011-8633-3dd646d814e9' ],
  created_at: 1764393006
}
 */

/**
 * Clob 单例类
 * 提供 CLOB 相关的所有功能
 */
class Clob {
  private static instance: Clob | null = null;
  private clobClient: ClobClient | null = null;
  private clobApiBase: string = '';
  private inited: boolean = false;

  /**
   * 私有构造函数，确保单例模式
   */
  private constructor() { }

  /**
   * 获取 Clob 单例实例
   * @returns Clob 单例实例
   */
  public static getInstance(): Clob {
    if (!Clob.instance) {
      Clob.instance = new Clob();
    }
    return Clob.instance;
  }

  /**
   * 获取 ClobClient 凭证
   * @param host CLOB 主机地址
   * @param privKey 钱包私钥
   * @returns ClobClient 凭证
   */
  private async getClobClientCreds() {
    const { clobHost } = getGlobalConfig();
    const { clobCreds, privKey } = getKeyConfig();
    if (clobCreds) {
      return clobCreds
    }
    const signer = new Wallet(privKey);
    const creds = await new ClobClient(clobHost, 137, signer).deriveApiKey(1);
    return creds;
  }


  public async init(): Promise<ClobClient> {
    if (this.clobClient) {
      return this.clobClient;
    }

    const globalConfig = getGlobalConfig();
    const keyConfig = getKeyConfig();
    const { clobHost: host, account } = globalConfig;
    const { funderAddress } = account;
    const signatureType = 2;

    const signer = new Wallet(keyConfig.privKey);
    const creds = await this.getClobClientCreds();

    this.clobApiBase = host;
    this.clobClient = new ClobClient(
      host,
      137,
      signer,
      creds,
      signatureType,
      funderAddress
    );

    await this.clobClient.getOk();
    this.inited = true;
  }


  /**
   * 下单接口
   * @param params 下单参数
   */
  public async postMarketOrder({
    tokenID,
    side,        // Side.BUY or Side.SELL
    amount,      // 金额
    tickSize = '0.01',
    negRisk = false,
    orderType = OrderType.FAK,  // 默认FAK
  }: {
    tokenID: string;
    side: Side;
    amount: number;
    tickSize?: string;
    negRisk?: boolean;
    orderType?: OrderType;
  }) {
    if (!this.inited) {
      throw new Error('ClobClient not initialized. Please call init() first.');
    }
    logInfo(`💰下单...`, { tokenID, side, amount, tickSize, negRisk, orderType })
    try {
      const resp = await this.clobClient!.createAndPostMarketOrder(
        {
          tokenID,
          side,
          amount: Number(amount),
        },
        // negRisk 表示是否开启负风险报价（Negative Risk Quotes）。
        // "风险溢价为负"指：你愿意在成交时为概率较小（赔率更高）的结果买入方承担部分风险，也就是让市场流动性更充裕，用户能以更优价格成交（即挂单价优于理论价值）；此时订单撮合时优先级会有变化，并可能触发特殊风控机制。
        // tickSize 是指支持的最小价格变动单位（如0.01表示价格只能是0.01、0.02、…等倍数）；下单时你指定价格必须是tickSize的整数倍。
        { tickSize: tickSize as any, negRisk },
        orderType as any
      );
      logInfo(`💰下单完成...`, { resp })
      return resp;
    } catch (err) {
      logInfo('placeOrder error:', err);
      throw err;
    }
  }

  /**
   * 查询指定订单ID的订单详情
   * @param orderId 订单ID
   * @returns 订单详情对象，或 null（若未找到或错误）
   */
  public async getOrder({
    orderId,
  }: {
    orderId: string;
  }): Promise<PolymarketOrderResult | null> {
    if (!this.inited) {
      throw new Error('ClobClient not initialized. Please call init() first.');
    }
    if (orderId) {
      let resp;
      while (!resp) {
        try {
          resp = await this.clobClient!.getOrder(orderId);
          return resp;
        } catch (err) {
          logInfo('getOrder error:', err);
        }
      }

    }

  }

  /**
   * 通过 token_id 获取订单簿摘要信息
   * @see https://docs.polymarket.com/api-reference/orderbook/get-order-book-summary
   * @param tokenId CLOB token 的唯一标识符
   * @returns OrderBookSummary 订单簿摘要数据
   */
  public async getOrderBookSummary(tokenId: string): Promise<OrderBookSummary | null> {
    if (!this.inited) {
      throw new Error('ClobClient not initialized. Please call init() first.');
    }
    const url = `${this.clobApiBase}/book`;
    const [error, data] = await awaitAxiosDataTo(Proxy.get(url, {
      params: { token_id: tokenId }
    }));

    if (error) {
      logInfo('Failed to get orderbook summary, token id:', tokenId);
      return null;
    }

    return data as OrderBookSummary;
  }

  /**
   * 获取订单簿的最优买卖价格
   * @param orderBook 订单簿摘要数据
   * @returns 最优买价和卖价
   */
  public getBestPrices(orderBook: OrderBookSummary | null): { bestBid: string | null; bestAsk: string | null } | null {
    if (!orderBook) {
      return null;
    }

    const bestBid = orderBook.bids.length > 0 ? orderBook.bids[orderBook.bids.length - 1]?.price : null;
    const bestAsk = orderBook.asks.length > 0 ? orderBook.asks[orderBook.asks.length - 1]?.price : null;

    return { bestBid, bestAsk };
  }

  /**
   * 获取指定市场的未完成订单
   * @param marketId 市场ID
   * @returns 未完成订单列表
   */
  public async getOpenOrders(marketId: string) {
    if (!this.inited) {
      throw new Error('ClobClient not initialized. Please call init() first.');
    }
    try {
      const resp = await this.clobClient!.getOpenOrders({ market: marketId });
      return resp;
    } catch (e) {
      logInfo(`getOpenOrders error, ${e}`);
      return []
    }

  }
}

// 导出单例实例的便捷访问方法
export const getClobModule = () => Clob.getInstance();

// 导出类型
export type { OrderBookSummary, OrderLevel, PolymarketOrderResult };
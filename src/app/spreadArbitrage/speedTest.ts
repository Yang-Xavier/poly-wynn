import { Side } from "@polymarket/clob-client";
import ClobApi from "@shared/api/clobApi";
import gammaApi from "@shared/api/gammaApi";
import { getConfig } from "./config";

type TestType = "limit" | "market";

// ========== 测试配置常量 ==========
/** 购买金额（限价单的 size 和市价单的 amount） */
const ORDER_AMOUNT = 5;

/** 限价单价格偏移量（相对于 bestBid，例如 -0.1 表示 bestBid - 0.1） */
const LIMIT_ORDER_PRICE_OFFSET = -0.1;
// =================================

/**
 * 获取 event 和 market 信息
 */
async function getEventAndMarket(eventEvent: string) {
  console.log(`[speedTest] 获取 event 信息: ${eventEvent}`);
  const event = await gammaApi.getEventBySlug(eventEvent);
  
  if (!event) {
    throw new Error(`Event not found: ${eventEvent}`);
  }

  console.log(`[speedTest] Event 信息获取成功: ${event.title}`);

  // 取出 event 中的第一个 market
  if (!event.markets || event.markets.length === 0) {
    throw new Error(`Event has no markets: ${eventEvent}`);
  }

  const market = event.markets[0];
  console.log(`[speedTest] 使用第一个 market: ${market.question || market.id}`);

  // 获取 bestBid
  if (market.bestBid === null || market.bestBid === undefined) {
    throw new Error(`Market has no bestBid: ${market.id}`);
  }

  const bestBid = market.bestBid;
  console.log(`[speedTest] Market bestBid: ${bestBid}`);

  // 获取第一个 outcome 的 tokenId
  if (!market.clobTokenIds || !market.outcomes) {
    throw new Error(`Market missing clobTokenIds or outcomes: ${market.id}`);
  }

  const tokenIds = JSON.parse(market.clobTokenIds) as string[];
  const outcomes = JSON.parse(market.outcomes) as string[];
  
  if (tokenIds.length === 0 || outcomes.length === 0) {
    throw new Error(`Market has no tokenIds or outcomes: ${market.id}`);
  }

  // 使用第一个 outcome 的 tokenId
  const tokenId = tokenIds[0];
  const firstOutcome = outcomes[0];
  console.log(`[speedTest] 使用第一个 outcome: ${firstOutcome}, tokenId: ${tokenId}`);

  return {
    event,
    market,
    tokenId,
    firstOutcome,
    bestBid,
  };
}

/**
 * 测试1: 限价单购买+取消订单
 */
async function testLimitOrder(eventEvent: string) {
  try {
    const { event, market, tokenId, firstOutcome, bestBid } = await getEventAndMarket(eventEvent);

    // 初始化 ClobApi
    const config = getConfig();
    const clobApi = new ClobApi({
      privKey: config.account.privKey,
      signatureType: 1,
      clobCreds: config.account.clobCreds,
      funderAddress: config.account.funderAddress,
    });

    // 下限价单，挂单价格为 bestBid + 偏移量，数量为配置的金额
    const orderPrice = bestBid + LIMIT_ORDER_PRICE_OFFSET;
    const orderSize = ORDER_AMOUNT;

    console.log(`[speedTest] 下限价单: tokenId=${tokenId}, price=${orderPrice}, size=${orderSize}, side=BUY`);
    
    const orderResponse = await clobApi.postLimitOrder({
      tokenId,
      side: Side.BUY,
      price: orderPrice,
      size: orderSize,
    });

    if (!orderResponse || !orderResponse.orderID) {
      throw new Error(`Failed to create order: ${JSON.stringify(orderResponse)}`);
    }

    const orderId = orderResponse.orderID;
    console.log(`[speedTest] 订单创建成功: orderId=${orderId}`);

    // 挂单完成后，取消订单
    console.log(`[speedTest] 取消订单: orderId=${orderId}`);
    const cancelResponse = await clobApi.cancelOrder({ orderId });
    
    console.log(`[speedTest] 订单取消成功: ${JSON.stringify(cancelResponse)}`);
    console.log(`[speedTest] 限价单测试完成！`);

    return {
      success: true,
      testType: "limit",
      event: {
        id: event.id,
        title: event.title,
        slug: event.slug,
      },
      market: {
        id: market.id,
        question: market.question,
        bestBid: market.bestBid,
        tokenId,
        outcome: firstOutcome,
      },
      order: {
        orderId,
        price: orderPrice,
        size: orderSize,
      },
      cancelResponse,
    };
  } catch (error) {
    console.error(`[speedTest] 限价单测试错误: ${error}`);
    throw error;
  }
}

/**
 * 测试2: 市价单购买
 */
async function testMarketOrder(eventEvent: string) {
  try {
    const { event, market, tokenId, firstOutcome, bestBid } = await getEventAndMarket(eventEvent);

    // 初始化 ClobApi
    const config = getConfig();
    const clobApi = new ClobApi({
      privKey: config.account.privKey,
      signatureType: 1,
      clobCreds: config.account.clobCreds,
      funderAddress: config.account.funderAddress,
    });

    // 下市价单，数量为配置的金额
    const orderAmount = ORDER_AMOUNT;
    const orderPrice = bestBid; // 使用 bestBid 作为参考价格

    console.log(`[speedTest] 下市价单: tokenId=${tokenId}, amount=${orderAmount}, price=${orderPrice}, side=BUY`);
    
    const orderResponse = await clobApi.postMarketOrder({
      tokenId,
      side: Side.BUY,
      amount: orderAmount,
      price: orderPrice,
    });

    if (!orderResponse || !orderResponse.orderID) {
      throw new Error(`Failed to create market order: ${JSON.stringify(orderResponse)}`);
    }

    const orderId = orderResponse.orderID;
    console.log(`[speedTest] 市价单创建成功: orderId=${orderId}`);

    // 等待一下，然后查询订单状态
    await new Promise(resolve => setTimeout(resolve, 1000));
    const orderInfo = await clobApi.getOrder({ orderId });
    console.log(`[speedTest] 订单状态: ${JSON.stringify(orderInfo)}`);
    console.log(`[speedTest] 市价单测试完成！`);

    return {
      success: true,
      testType: "market",
      event: {
        id: event.id,
        title: event.title,
        slug: event.slug,
      },
      market: {
        id: market.id,
        question: market.question,
        bestBid: market.bestBid,
        tokenId,
        outcome: firstOutcome,
      },
      order: {
        orderId,
        amount: orderAmount,
        price: orderPrice,
        orderInfo,
      },
    };
  } catch (error) {
    console.error(`[speedTest] 市价单测试错误: ${error}`);
    throw error;
  }
}

/**
 * 速度测试主函数
 * @param eventEvent event 的 slug
 * @param testType 测试类型: "limit" 或 "market"
 */
export async function speedTest(eventEvent: string, testType: TestType = "limit") {
  console.log(`[speedTest] 开始测试，类型: ${testType}`);
  
  if (testType === "limit") {
    return await testLimitOrder(eventEvent);
  } else if (testType === "market") {
    return await testMarketOrder(eventEvent);
  } else {
    throw new Error(`不支持的测试类型: ${testType}，支持的类型: limit, market`);
  }
}

/**
 * 主函数：可以直接通过 node/bun 执行
 */
async function main() {
  // 从命令行参数获取 eventEvent 和 testType
  const eventEvent = process.argv[2];
  const testType = (process.argv[3] || "limit") as TestType;
  
  if (!eventEvent) {
    console.error("Usage: bun src/app/spreadArbitrage/speedTest.ts <eventSlug> [testType]");
    console.error("  testType: 'limit' (限价单+取消) 或 'market' (市价单)，默认为 'limit'");
    console.error("Example: bun src/app/spreadArbitrage/speedTest.ts btc-updown-15m-1768039200 limit");
    console.error("Example: bun src/app/spreadArbitrage/speedTest.ts btc-updown-15m-1768039200 market");
    process.exit(1);
  }

  if (testType !== "limit" && testType !== "market") {
    console.error(`错误的测试类型: ${testType}，支持的类型: limit, market`);
    process.exit(1);
  }

  try {
    // 执行速度测试
    const result = await speedTest(eventEvent, testType);

    console.log("\n========== 测试完成 ==========");

    process.exit(0);
  } catch (error) {
    console.error("执行失败:", error);
    process.exit(1);
  }
}

// 如果直接执行此文件，运行 main 函数
// 检查是否通过命令行直接执行（有参数）或者是主模块
const isDirectExecution = 
  (typeof require !== "undefined" && require.main === module) ||
  (process.argv.length > 2 && process.argv[1]?.includes("speedTest"));

if (isDirectExecution) {
  main();
}

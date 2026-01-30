import { Side } from "@polymarket/clob-client";
import ClobApi from "@shared/api/clobApi";
import gammaApi from "@shared/api/gammaApi";
import { getConfig } from "./config";

/**
 * 速度测试：获取 event 信息，下限价单并取消
 * @param eventEvent event 的 slug
 */
export async function speedTest(eventEvent: string) {
  try {
    // 1. 获取 event 相关信息
    console.log(`[speedTest] 获取 event 信息: ${eventEvent}`);
    const event = await gammaApi.getEventBySlug(eventEvent);
    
    if (!event) {
      throw new Error(`Event not found: ${eventEvent}`);
    }

    console.log(`[speedTest] Event 信息获取成功: ${event.title}`);

    // 2. 取出 event 中的第一个 market
    if (!event.markets || event.markets.length === 0) {
      throw new Error(`Event has no markets: ${eventEvent}`);
    }

    const market = event.markets[0];
    console.log(`[speedTest] 使用第一个 market: ${market.question || market.id}`);

    // 3. 获取 bestBid
    if (market.bestBid === null || market.bestBid === undefined) {
      throw new Error(`Market has no bestBid: ${market.id}`);
    }

    const bestBid = market.bestBid;
    console.log(`[speedTest] Market bestBid: ${bestBid}`);

    // 4. 获取第一个 outcome 的 tokenId
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

    // 5. 初始化 ClobApi
    const config = getConfig();
    const clobApi = new ClobApi({
      privKey: config.account.privKey,
      signatureType: 1,
      clobCreds: config.account.clobCreds,
      funderAddress: config.account.funderAddress,
    });

    // 6. 下限价单，挂单价格为 bestBid - 0.1，数量为 10
    const orderPrice = bestBid - 0.1;
    const orderSize = 10;

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

    // 7. 挂单完成后，取消订单
    console.log(`[speedTest] 取消订单: orderId=${orderId}`);
    const cancelResponse = await clobApi.cancelOrder({ orderId });
    
    console.log(`[speedTest] 订单取消成功: ${JSON.stringify(cancelResponse)}`);
    console.log(`[speedTest] 测试完成！`);

    return {
      success: true,
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
    console.error(`[speedTest] 错误: ${error}`);
    throw error;
  }
}

/**
 * 主函数：可以直接通过 node/bun 执行
 */
async function main() {
  // 从命令行参数获取 eventEvent
  const eventEvent = process.argv[2];
  
  if (!eventEvent) {
    console.error("Usage: bun src/app/spreadArbitrage/speedTest.ts <eventSlug>");
    console.error("Example: bun src/app/spreadArbitrage/speedTest.ts btc-updown-15m-1768039200");
    process.exit(1);
  }

  try {
    // 执行速度测试
    const result = await speedTest(eventEvent);

    console.log("\n========== 测试结果 ==========");
    console.log(JSON.stringify(result, null, 2));
    console.log("============================\n");

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

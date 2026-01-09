import { getGlobalConfig } from "@crypto15min/utils/config";
import { getAccountUsdcBalanceByAlchemy } from "@shared/web3/account";
import { redeemAllPositions } from "./utils/relayerRedeem";
import { buy } from "./module/trade";
import { getClobModule } from "./module/clob";
import { OrderType, Side } from "@polymarket/clob-client";
import { waitForOrderMatched } from "@shared/utils/waitForOrderMatched";
import { getDataFlowInstances, initializeDataFlow } from "./module/dataFlow";
import { logInfo } from "./module/logger";

export const debug = async () => {
  const config = getGlobalConfig();
  initializeDataFlow({ symbol: "eth" });
  await getDataFlowInstances().userWs.connect();
  getDataFlowInstances().userWs.subscribe();
  await getClobModule().init();

  const { orderID } = await getClobModule().postMarketOrder({
    tokenID: "94559586571241563470235664821564670251180951772614764383113614156422396181162",
    amount: 1,
    side: Side.BUY,
    orderType: OrderType.FAK,
  });
  const result = await waitForOrderMatched({
    orderId: orderID,
    userWs: getDataFlowInstances().userWs,
  });
  logInfo(`result: ${JSON.stringify(result)}`);
};

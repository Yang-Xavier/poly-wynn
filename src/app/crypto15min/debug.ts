import { getGlobalConfig } from "@crypto15min/utils/config";

import { buy } from "./module/trade";
import { getClobModule } from "./module/clob";
import { OrderType, Side } from "@polymarket/clob-client";
import { waitForOrderMatched } from "@shared/utils/waitForOrderMatched";
import { getDataFlowInstances, initializeDataFlow } from "./module/dataFlow";
import { logInfo } from "./module/logger";
import { getAccountBalance } from "@shared/web3/account";

export const debug = async () => {
  const config = getGlobalConfig();

  await getClobModule().init();
  const { balance } = await getAccountBalance(
    config.account.funderAddress,
    config.collateralAddress
  );
  console.log(`balance: ${balance}`);
};

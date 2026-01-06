import { getGlobalConfig } from "@crypto15min/utils/config";
import { redeemAllPositions } from "./utils/relayerRedeem";

export const redeem = async () => {
  const globalConfig = getGlobalConfig();
  await redeemAllPositions({ funderAddress: globalConfig.account.funderAddress });
};

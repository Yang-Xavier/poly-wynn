import { getGlobalConfig } from "@crypto15min/utils/config";
import { getAccountUsdcBalanceByAlchemy } from "@shared/web3/account";
import { redeemAllPositions } from "./utils/relayerRedeem";

export const debug = async () => {
  const config = getGlobalConfig();

  const funderAddress = config.account.funderAddress;
  const data = await redeemAllPositions({
    funderAddress: "0x8dF2E7574F5E97103F037ed45fB323FdBeABEEA8",
  });
  console.log("data:", data);
};

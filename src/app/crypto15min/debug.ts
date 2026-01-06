import { getGlobalConfig } from "@crypto15min/utils/config";
import { getAccountUsdcBalanceByAlchemy } from "@shared/web3/account";

export const debug = async () => {
  const config = getGlobalConfig();

  const funderAddress = config.account.funderAddress;
  const balance = await getAccountUsdcBalanceByAlchemy(funderAddress);
  console.log("funder balance:", balance);
};

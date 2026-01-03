import { logError, logInfo, logTrade } from "../logger";
import { FUNDER_ADDRESS, USDC_ADDRESS } from "@shared/constants";
import { waitFor } from "@shared/utils/waitFor";
import { getAccountBalance } from "@shared/web3/account";

export const getAccountBalanceWithRetry = async () => {
  const maxRetries = 3;
  const retryDelayMs = 1000 * 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { balance } = await getAccountBalance(FUNDER_ADDRESS, USDC_ADDRESS);
      logInfo(`getAccountBalanceWithRetry success: ${balance}`);
      return balance;
    } catch (error) {
      if (attempt < maxRetries) {
        await waitFor(retryDelayMs);
      }
      logError(`getAccountBalanceWithRetry failed: ${error}, attempt: ${attempt}/${maxRetries}`);
    }
  }
};

export const logAccountBalance = async () => {
  const balance = await getAccountBalanceWithRetry();
  logTrade("balance", {
    balance,
  });
  logInfo(`account balance: ${balance}`);
};

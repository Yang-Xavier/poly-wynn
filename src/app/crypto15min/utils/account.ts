import { getGlobalConfig } from "./config";
import { logInfo } from "@crypto15min/module/logger";
import tradeReport from "../module/tradeReport";
import { getAccountBalance as getAccountCommon } from "@shared/web3/account";
import { USDC_ADDRESS } from "@shared/constants";
import { waitFor } from "./tools";

let globalBalance = 0;
/**
 * 查询某地址在 Polygon 上某个 ERC20 代币的余额
 * @param funderAddress 要查询的地址
 * @param tokenAddress  代币合约地址，默认为全局配置中的 USDC
 * @returns { rawBalance, decimals, formatted } 原始余额、精度、格式化后的字符串
 */
export const getAccountBalance = async (
  funderAddress: string,
  tokenAddress: string = USDC_ADDRESS
) => {
  const maxRetries = 3;
  const retryDelayMs = 1000;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { balance } = await getAccountCommon(funderAddress, tokenAddress);
      globalBalance = balance;
      break;
    } catch (error) {
      lastError = error;
      logInfo(
        `getAccountBalance 调用失败，第 ${attempt}/${maxRetries} 次尝试: ${(error as Error).message || error}`
      );

      if (attempt < maxRetries) {
        await waitFor(retryDelayMs);
      }
    }
  }
  return {
    formatted: globalBalance,
  };
};

export const logAccountBalance = async () => {
  const globalConfig = getGlobalConfig();
  const { formatted } = await getAccountBalance(
    globalConfig.account.funderAddress,
    globalConfig.collateralAddress
  );
  logInfo("balance", formatted);
  tradeReport.addReport("balance", {
    balance: Number(formatted),
  });
};

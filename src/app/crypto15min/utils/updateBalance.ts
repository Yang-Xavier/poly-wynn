import { getAccountBalance } from "@shared/web3/account";
import { getConfig } from "./config";
import { logInfo } from "@crypto15min/module/logger";

/**
 * 轮询获取账户余额并更新
 * @param setBalance 设置余额的回调函数
 * @param interval 轮询间隔（毫秒），默认 180000ms (3分钟)
 * @returns 返回停止轮询的函数
 */
export const startBalancePolling = (
  setBalance: (balance: number) => void,
  interval: number = 180000
): (() => void) => {
  const config = getConfig();

  let pollingTimer: NodeJS.Timeout | null = null;
  let isPolling = true;

  // 获取余额的函数
  const fetchBalance = async () => {
    try {
      const { balance } = await getAccountBalance(
        config.account.funderAddress,
        config.collateralAddress
      );
      setBalance(Number(balance));
    } catch (error) {
      logInfo(`[updateBalance] 获取余额失败: ${error}`);
    }
  };

  // 立即执行一次
  fetchBalance();

  // 开始轮询
  pollingTimer = setInterval(() => {
    if (isPolling) {
      fetchBalance();
    }
  }, interval);

  // 返回停止轮询的函数
  return () => {
    isPolling = false;
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  };
};

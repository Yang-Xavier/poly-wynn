import { createPublicClient, http, parseAbi, Address, formatUnits } from "viem";
import { polygon } from "viem/chains";
import { getGlobalConfig } from "./config";
import { getLoggerModule, logError, logInfo, LogLevel } from "src/module/logger";

// 通用 ERC20 ABI（只包含查询余额&精度）
const erc20Abi = parseAbi([
    "function balanceOf(address owner) view returns (uint256)",
    "function decimals() view returns (uint8)",
]);

/**
 * 查询某地址在 Polygon 上某个 ERC20 代币的余额
 * @param funderAddress 要查询的地址
 * @param tokenAddress  代币合约地址，默认为全局配置中的 USDC
 * @returns { rawBalance, decimals, formatted } 原始余额、精度、格式化后的字符串
 */
export const getAccountBalance = async (
    funderAddress: string,
    tokenAddress?: string,
) => {
    const maxRetries = 3;
    const retryDelayMs = 1000;

    const globalConfig = getGlobalConfig();
    const rpcUrl = globalConfig.redeemConfig.rpcUrl as string;
    const erc20Address = (tokenAddress || globalConfig.redeemConfig.usdc) as Address;

    const publicClient = createPublicClient({
        chain: polygon,
        transport: http(rpcUrl),
    });

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const [decimals, rawBalance] = await Promise.all([
                publicClient.readContract({
                    address: erc20Address,
                    abi: erc20Abi,
                    functionName: "decimals",
                    authorizationList: [],
                }),
                publicClient.readContract({
                    address: erc20Address,
                    abi: erc20Abi,
                    functionName: "balanceOf",
                    args: [funderAddress as Address],
                    authorizationList: [],
                }),
            ]);

            const formatted = formatUnits(rawBalance, decimals);

            return {
                rawBalance,
                decimals: Number(decimals),
                formatted,
            };
        } catch (error) {
            lastError = error;
            logInfo(
                `getAccountBalance 调用失败，第 ${attempt}/${maxRetries} 次尝试: ${(error as Error).message || error}`
            );

            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
            }
        }
    }
};

export const logAccountBalance = async () => {
    const globalConfig = getGlobalConfig();
    const { formatted } = await getAccountBalance(globalConfig.account.funderAddress, globalConfig.account.balanceTokenAddress);
    getLoggerModule().customLog('trade', LogLevel.INFO, `💰账户余额: ${formatted}`)
};
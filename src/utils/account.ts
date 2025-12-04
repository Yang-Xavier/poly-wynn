import { createPublicClient, http, parseAbi, Address, formatUnits } from "viem";
import { polygon } from "viem/chains";
import { getGlobalConfig } from "./config";
import { getLoggerModule, logInfo, LogLevel } from "src/module/logger";

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
    const globalConfig = getGlobalConfig();
    const rpcUrl = globalConfig.redeemConfig.rpcUrl as string;
    const erc20Address = (tokenAddress || globalConfig.redeemConfig.usdc) as Address;

    const publicClient = createPublicClient({
        chain: polygon,
        transport: http(rpcUrl),
    });

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
};

export const logAccountBalance = async () => {
    const globalConfig = getGlobalConfig();
    const { formatted } = await getAccountBalance(globalConfig.account.funderAddress, globalConfig.account.balanceTokenAddress);
    getLoggerModule().customLog('trade', LogLevel.INFO, `💰账户余额: ${formatted}`)
};
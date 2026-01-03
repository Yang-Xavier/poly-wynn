import { createPublicClient, http, parseAbi, Address, formatUnits } from "viem";
import { polygon } from "viem/chains";
import { RPC_URL, USDC_ADDRESS } from "@shared/constants";

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
export const getAccountBalance = async (funderAddress: string, tokenAddress?: string) => {
  const erc20Address = tokenAddress || USDC_ADDRESS;

  const publicClient = createPublicClient({
    chain: polygon,
    transport: http(RPC_URL),
  });

  try {
    const [decimals, rawBalance] = await Promise.all([
      publicClient.readContract({
        address: erc20Address as `0x${string}`,
        abi: erc20Abi,
        functionName: "decimals",
        authorizationList: [],
      }),
      publicClient.readContract({
        address: erc20Address as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [funderAddress as Address],
        authorizationList: [],
      }),
    ]);

    const balance = formatUnits(rawBalance, decimals);

    return {
      rawBalance,
      decimals: Number(decimals),
      balance,
    };
  } catch (error) {
    throw error;
  }
};

import { createPublicClient, http, parseAbi, Address, formatUnits } from "viem";
import { polygon } from "viem/chains";
import { RPC_URL, USDC_ADDRESS } from "@shared/constants";
import Proxy from "@shared/Proxy";

// const erc20Abi = parseAbi([
//   "function balanceOf(address owner) view returns (uint256)",
//   "function decimals() view returns (uint8)",
// ]);

// /**
//  * 查询某地址在 Polygon 上某个 ERC20 代币的余额
//  * @param funderAddress 要查询的地址
//  * @param tokenAddress  代币合约地址，默认为全局配置中的 USDC
//  * @returns { rawBalance, decimals, formatted } 原始余额、精度、格式化后的字符串
//  */
// export const getAccountBalance = async (funderAddress: string, tokenAddress?: string) => {
//   const erc20Address = tokenAddress || USDC_ADDRESS;

//   const publicClient = createPublicClient({
//     chain: polygon,
//     transport: http(RPC_URL),
//   });

//   try {
//     const [decimals, rawBalance] = await Promise.all([
//       publicClient.readContract({
//         address: erc20Address as `0x${string}`,
//         abi: erc20Abi,
//         functionName: "decimals",
//         authorizationList: [],
//       }),
//       publicClient.readContract({
//         address: erc20Address as `0x${string}`,
//         abi: erc20Abi,
//         functionName: "balanceOf",
//         args: [funderAddress as Address],
//         authorizationList: [],
//       }),
//     ]);

//     const balance = formatUnits(rawBalance, decimals);

//     return {
//       rawBalance,
//       decimals: Number(decimals),
//       balance,
//     };
//   } catch (error) {
//     throw error;
//   }
// };

export const getAccountBalance = async (
  funderAddress: string,
  tokenAddress: string = USDC_ADDRESS
) => {
  const balance = await getAccountUsdcBalanceByAlchemy(funderAddress, tokenAddress);
  return {
    balance,
  };
};

export const getAccountUsdcBalanceByAlchemy = async (
  funderAddress: string,
  tokenAddress: string = USDC_ADDRESS
) => {
  const alchemyRpcUrl = "https://polygon-mainnet.g.alchemy.com/v2/";
  const data = `0x70a08231000000000000000000000000${funderAddress.substring(2).toLowerCase()}`;
  const reqBody = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [
        {
          data: data,
          to: tokenAddress,
        },
        "latest",
      ],
    },
  ];
  const resp = await Proxy.post(alchemyRpcUrl, reqBody, {
    headers: {
      accept: "*/*",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,la;q=0.7",
      authorization: "Bearer mewmTuTYExTSI0lZisD2szwmi35fZY-r",
      "cache-control": "max-age=0",
      "content-type": "application/json",
      origin: "https://polymarket.com",
      priority: "u=1, i",
      referer: "https://polymarket.com/",
      "sec-ch-ua": '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "cross-site",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
    },
  });
  const balance = parseInt(resp.data[0].result, 16) / 10 ** 6;
  return Number(balance.toFixed(2));
};

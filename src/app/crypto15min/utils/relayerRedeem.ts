import { createWalletClient, encodeFunctionData, http, Hex, zeroHash, Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import {
  RelayClient,
  OperationType,
  SafeTransaction,
  RelayerTxType,
} from "@polymarket/builder-relayer-client";
import { BuilderConfig } from "@polymarket/builder-signing-sdk";

import { getGlobalConfig } from "@crypto15min/utils/config";
import { logInfo } from "@crypto15min/module/logger";

import dataApi from "@shared/api/dataApi";
import { getBuilderCreds } from "@shared/getBuilderCreds";

// 参考官方示例：
// https://github.com/Polymarket/builder-relayer-client/tree/c42a05473ed73db1d76522d6a4746013880dd56e
// README 中的 CTF redeemPositions 示例

// CTF redeemPositions ABI（对象形式，方便 encodeFunctionData 使用）
// 与 README 中示例保持一致：
// const ctfRedeemAbi = [
//   {
//     "constant": false,
//     "inputs": [
//       {"name": "collateralToken", "type": "address"},
//       {"name": "parentCollectionId", "type": "bytes32"},
//       {"name": "conditionId", "type": "bytes32"},
//       {"name": "indexSets", "type": "uint256[]"}
//     ],
//     "name": "redeemPositions",
//     "outputs": [],
//     "payable": false,
//     "stateMutability": "nonpayable",
//     "type": "function"
//   }
// ];
const ctfRedeemAbi = [
  {
    constant: false,
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "parentCollectionId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
      { name: "indexSets", type: "uint256[]" },
    ],
    name: "redeemPositions",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export type RelayerRedeemConfig = {
  relayerUrl: string;
  rpcUrl: string;
  ctf: Address;
  usdc: Address;
  chainId: number;
};

/**
 * 步骤 1：从 config.json 构造 Redeem 相关配置
 * - 负责处理 relayerUrl 的空格问题
 * - 校验基础字段是否存在
 */
function buildRelayerRedeemConfig(): RelayerRedeemConfig {
  const globalConfig = getGlobalConfig();
  const redeemConfig = globalConfig.redeemConfig;

  const relayerUrl = redeemConfig.relayerUrl;

  const rpcUrl = redeemConfig.rpcUrl;
  const ctf = redeemConfig.ctf;
  const usdc = redeemConfig.usdc;

  if (!relayerUrl) {
    throw new Error("[RelayerRedeem] 缺少 relayerUrl 配置");
  }
  if (!rpcUrl) {
    throw new Error("[RelayerRedeem] 缺少 rpcUrl 配置（redeemConfig.rpcUrl）");
  }
  if (!ctf) {
    throw new Error("[RelayerRedeem] 缺少 CTF 合约地址配置（redeemConfig.ctf）");
  }
  if (!usdc) {
    throw new Error("[RelayerRedeem] 缺少 USDC 地址配置（redeemConfig.usdc）");
  }

  return {
    relayerUrl,
    rpcUrl,
    ctf: ctf as Address,
    usdc: usdc as Address,
    chainId: polygon.id,
  };
}

/**
 * 步骤 2：根据私钥和 rpc 创建 viem 钱包，以及 BuilderConfig
 */
function createWalletAndBuilder(config: RelayerRedeemConfig) {
  const globalConfig = getGlobalConfig();

  const privKey = globalConfig.account.privKey as Hex | undefined;
  if (!privKey) {
    throw new Error("[RelayerRedeem] 缺少私钥配置（keyConfig.privKey）");
  }

  const account = privateKeyToAccount(privKey);
  const wallet = createWalletClient({
    chain: polygon,
    transport: http(config.rpcUrl),
    account,
  });

  const { builderCreds, builderIndex } = getBuilderCreds();
  logInfo(`[RelayerRedeem] 使用 第 ${builderIndex} 个builder的凭证`);
  if (!builderCreds?.key || !builderCreds?.secret || !builderCreds?.passphrase) {
    throw new Error("[RelayerRedeem] 缺少 redeemCreds（builder 本地 API Key）配置");
  }

  const builderConfig = new BuilderConfig({
    localBuilderCreds: {
      key: builderCreds.key,
      secret: builderCreds.secret,
      passphrase: builderCreds.passphrase,
    },
  });

  return { account, wallet, builderConfig };
}

/**
 * 步骤 3：创建 RelayClient
 */
function createRelayClientForRedeem(
  config: RelayerRedeemConfig,
  wallet: any,
  builderConfig: BuilderConfig
): RelayClient {
  const client = new RelayClient(
    config.relayerUrl,
    config.chainId,
    wallet,
    builderConfig,
    RelayerTxType.PROXY
  );

  return client;
}

/**
 * 构造 CTF 的 redeemPositions 交易
 * 对应 README 中的 createCtfRedeemTransaction：
 *
 * function createCtfRedeemTransaction(
 *   ctfAddress: string,
 *   collateralToken: string,
 *   conditionId: string
 * ): SafeTransaction { ... }
 */
function createCtfRedeemTransaction(
  ctfAddress: Address,
  collateralToken: Address,
  conditionId: Hex,
  indexSets: bigint[] = [1n, 2n]
): SafeTransaction {
  const calldata = encodeFunctionData({
    abi: ctfRedeemAbi,
    functionName: "redeemPositions",
    args: [collateralToken, zeroHash, conditionId, indexSets],
  });

  return {
    to: ctfAddress,
    data: calldata,
    value: "0",
    operation: OperationType.Call,
  };
}

/**
 * 步骤 4（总入口）：使用 Relayer 执行单个 CTF redeemPositions
 *
 * 按顺序执行：
 *  1. 加载并校验配置（buildRelayerRedeemConfig）
 *  2. 创建钱包和 BuilderConfig（createWalletAndBuilder）
 *  3. 初始化 RelayClient（createRelayClientForRedeem）
 *  4. 构造 redeemPositions 交易并通过 Relayer 执行
 */
export async function redeemWithRelayer(
  conditionId: string,
  indexSets: bigint[] = [1n, 2n]
): Promise<{
  transactionHash?: string;
  rawResult: any;
}> {
  // 1. 加载配置
  const config = buildRelayerRedeemConfig();
  logInfo(`[Redeem] 加载配置: ${JSON.stringify(config)}`);

  // 2. 创建钱包 & BuilderConfig
  const { wallet, builderConfig } = createWalletAndBuilder(config);
  logInfo(`[Redeem] 创建钱包和 BuilderConfig: ${JSON.stringify(wallet)}`);
  // 3. 初始化 RelayClient
  const client = createRelayClientForRedeem(config, wallet, builderConfig);
  logInfo(`[Redeem] 初始化 RelayClient: ${JSON.stringify(client)}`);
  // 4. 构造 redeemPositions 交易
  const redeemTx = createCtfRedeemTransaction(
    config.ctf,
    config.usdc,
    conditionId as Hex,
    indexSets
  );
  logInfo(`[Redeem] 构造 redeemPositions 交易: ${JSON.stringify(redeemTx)}`);
  try {
    const response = await client.execute([redeemTx], "redeem positions");
    const result: any = await response.wait();
    logInfo(`[Redeem] 执行 redeemPositions 交易成功: ${JSON.stringify(result)}`);
    return {
      transactionHash: result?.transactionHash,
      rawResult: result,
    };
  } catch (error: any) {
    logInfo(`[Redeem] 执行 redeemPositions 交易失败: ${JSON.stringify(error)}`);
    throw error;
  }
}

export async function redeemAllPositions({ funderAddress }: { funderAddress: string }) {
  try {
    const positions = await dataApi.getPositions({
      user: funderAddress,
      redeemable: true,
      limit: 1000,
    });
    const redeemablePositions = positions.filter(
      (position) => position.redeemable && position.currentValue > 0
    );

    logInfo(`[Redeem] 有 ${redeemablePositions.length} 个仓位, 等待赎回...`);
    for (let i = 0; i < redeemablePositions.length; i++) {
      try {
        const position = redeemablePositions[i];

        const result = await redeemWithRelayer(position.conditionId);
        if (result.transactionHash) {
          logInfo(
            `[Redeem] 赎回成功: ${position.conditionId}, transactionHash: ${result.transactionHash}`
          );
        } else {
          logInfo(`[Redeem] 赎回失败: ${position.conditionId}`);
        }
      } catch (error) {
        logInfo(`[Redeem] 赎回第${i + 1}个仓位失败: ${error}`);
      }
    }
  } catch (error) {
    logInfo(`[Redeem] 赎回失败: ${error}`);
  }

  logInfo(`[Redeem] 赎回完成`);
}

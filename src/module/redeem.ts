import {
    createWalletClient,
    createPublicClient,
    encodeFunctionData,
    http,
    Hex,
    zeroHash,
    parseAbi,
    Address,
    toHex,
    concat,
    pad,
} from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import { polygon } from "viem/chains";
import { logError, logInfo } from "./logger";
import { getGlobalConfig, getKeyConfig } from "@utils/config";
import { getGammaDataModule } from "./gammaData";
import { redeemWithRelayer } from "@utils/relayerRedeem";

// CTF 合约的 redeemPositions ABI
const ctfRedeemAbi = parseAbi([
    "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)"
]);

// Safe 钱包的 ABI
const safeAbi = parseAbi([
    "function nonce() external view returns (uint256)",
    "function getOwners() external view returns (address[])",
    "function isOwner(address owner) external view returns (bool)",
    "function getThreshold() external view returns (uint256)",
    "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) external view returns (bytes32)",
    "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) external payable returns (bool success)"
]);

const redeemPositionsAbi = parseAbi([
    "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)",
]);


export type RedeemConfig = {
    privKey: string;
    rpcUrl: string;
    ctf: string; // CTF 合约地址
    safeWallet: string; // AA 钱包（Safe 钱包）地址
    usdc: string; // USDC 代币地址
}

/**
 * Redeem 单例类
 * 提供赎回相关的所有功能
 */
class Redeem {
    private static instance: Redeem | null = null;
    private config: RedeemConfig | null = null;

    /**
     * 私有构造函数，确保单例模式
     */
    private constructor() {
        const globalConfig = getGlobalConfig();
        const keyConfig = getKeyConfig();
        this.config = {
            privKey: keyConfig.privKey,
            rpcUrl: globalConfig.redeemConfig.rpcUrl,
            ctf: globalConfig.redeemConfig.ctf,
            safeWallet: globalConfig.account.funderAddress,
            usdc: globalConfig.redeemConfig.usdc,
        };
    }

    /**
     * 获取 Redeem 单例实例
     * @returns Redeem 单例实例
     */
    public static getInstance(): Redeem {
        if (!Redeem.instance) {
            Redeem.instance = new Redeem();
        }
        return Redeem.instance;
    }

    public async redeemWithEOA (
        conditionId: string,
        indexSets: bigint[] = [1n, 2n],
    ) {
        const globalConfig = getGlobalConfig();
        const keyConfig = getKeyConfig();

        const privKey = keyConfig.privKey as Hex | undefined;
        const rpcUrl = globalConfig?.redeemConfig?.rpcUrl as string | undefined;
        const usdcAddress = globalConfig?.redeemConfig?.usdc as Address | undefined;
        const ctfAddress = globalConfig?.redeemConfig?.ctf as Address | undefined;

        if (!privKey) {
            throw new Error("缺少私钥配置（keyConfig.privKey）");
        }
        if (!rpcUrl) {
            throw new Error("缺少 RPC 配置（globalConfig.redeemConfig.rpcUrl）");
        }
        if (!usdcAddress) {
            throw new Error("缺少 USDC 地址配置（globalConfig.redeemConfig.usdc）");
        }
        if (!ctfAddress) {
            throw new Error("缺少 CTF 合约地址配置（globalConfig.redeemConfig.ctf）");
        }

        // 创建 EOA 账户与 viem 客户端
        const account = privateKeyToAccount(privKey);
        const publicClient = createPublicClient({
            chain: polygon,
            transport: http(rpcUrl),
        });
        const walletClient = createWalletClient({
            chain: polygon,
            transport: http(rpcUrl),
            account,
        });

        logInfo("[newRedeem] Starting redeem via EOA...");
        console.log("[newRedeem] Wallet", { address: account.address });
        console.log("[newRedeem] CTF", { address: ctfAddress });
        console.log("[newRedeem] USDC", { address: usdcAddress });
        console.log("[newRedeem] ConditionId", { conditionId });
        console.log("[newRedeem] IndexSets", { indexSets: indexSets.map(i => i.toString()) });

        // 对应 Python 版：
        // txn_hash_bytes = ctf.functions.redeemPositions(
        //     usdc_address,
        //     HASH_ZERO,
        //     condition_id,
        //     [1, 2],
        // ).transact()
        try {
            const hash = await walletClient.writeContract({
                address: ctfAddress,
                abi: redeemPositionsAbi,
                functionName: "redeemPositions",
                args: [
                    usdcAddress,
                    zeroHash,                  // parentCollectionId = HASH_ZERO
                    conditionId as Hex,        // conditionId
                    indexSets,                 // [1, 2]
                ],
                account,
                chain: polygon,
            });

            console.log("[newRedeem] Redeem transaction hash", { hash });

            const receipt = await publicClient.waitForTransactionReceipt({ hash });

            if (receipt.status === "success") {
                logInfo("[newRedeem] Redeem complete!", { hash, blockNumber: receipt.blockNumber });
            } else {
                logError("[newRedeem] Redeem failed", { hash, receipt });
                throw new Error("Redeem transaction failed");
            }

            return { hash, receipt, success: receipt.status === "success" };
        } catch (e: any) {
            logError("[newRedeem] Error redeeming Outcome Tokens", {
                error: e?.message || String(e),
            });
            throw e;
        }
    };


    public async redeemAll(funderAddress: string) {
        const positions = await getGammaDataModule().getRedeemablePositions({ funderAddress });


        logInfo(`[Redeem] 有 ${positions.length} 个仓位, 等待赎回...`);
        for (let i = 0; i < positions.length; i++) {
            try {
                const position = positions[i];
                logInfo(`[Redeem] 开始赎回第${i + 1}个仓位: ${position.conditionId}`);
                const result = await redeemWithRelayer(position.conditionId);
                if (result.transactionHash) {
                    logInfo(`[Redeem] 赎回成功: ${position.conditionId}, transactionHash: ${result.transactionHash}`);
                } else {
                    logInfo(`[Redeem] 赎回失败: ${position.conditionId}`);
                }
            } catch (error) {
                logError(`[Redeem] 赎回第${i + 1}个仓位失败: ${error}`);
            }
        }

        logInfo(`[Redeem] 赎回完成`);
    }
}

// 导出单例实例的便捷访问方法
export const getRedeemModule = () => Redeem.getInstance();


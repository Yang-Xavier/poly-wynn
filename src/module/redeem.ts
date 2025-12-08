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
import {logError, logInfo} from "./logger";
import { getGlobalConfig, getKeyConfig } from "@utils/config";
import { getGammaDataModule } from "./gammaData";

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

    /**
     * 通过 EOA 钱包调用 AA 钱包（GnosisSafeProxy）执行 CTF 合约的 redeemPositions
     * 
     * GnosisSafeProxy 是一个代理合约，通过 delegatecall 将所有调用转发到实际的 Safe 合约。
     * 我们可以直接调用代理合约地址，就像调用实际的 Safe 合约一样。
     * 
     * @param conditionId 条件ID
     * @param indexSets 索引集合数组，默认为 [1, 2]（Polymarket 标准）
     */
    public async redeemViaAAWallet(
        conditionId: string,
        indexSets: bigint[] = [BigInt(1), BigInt(2)],
    ) {

        // 创建账户和客户端
        const account = privateKeyToAccount(this.config.privKey as Hex);
        const publicClient = createPublicClient({
            chain: polygon,
            transport: http(this.config.rpcUrl),
        });
        const walletClient = createWalletClient({
            account,
            chain: polygon,
            transport: http(this.config.rpcUrl),
        });

        const safeWalletAddress = this.config.safeWallet as Address;
        const ctfAddress = this.config.ctf as Address;
        const usdcAddress = this.config.usdc as Address;

        logInfo(`[Redeem] 开始通过AA钱包执行Redeem操作...`);
        console.log(`[Redeem] Safe钱包地址: ${safeWalletAddress}`);
        console.log(`[Redeem] CTF合约地址: ${ctfAddress}`);
        console.log(`[Redeem] ConditionId: ${conditionId}`);
        console.log(`[Redeem] IndexSets: ${indexSets.map(i => i.toString()).join(", ")}`);

        // 1. 编码CTF合约的redeemPositions调用数据
        const redeemData = encodeFunctionData({
            abi: ctfRedeemAbi,
            functionName: "redeemPositions",
            args: [usdcAddress, zeroHash, conditionId as Hex, indexSets],
        });

        console.log(`[Redeem] 已编码Redeem数据: ${redeemData}`);

        // 2. 获取Safe的当前nonce
        const nonce = await publicClient.readContract({
            address: safeWalletAddress,
            abi: safeAbi,
            functionName: "nonce",
            authorizationList: [],
        });

        console.log(`[Redeem] Safe当前nonce: ${nonce.toString()}`);

        // 2.5. 验证签名者是否是Safe的所有者
        const isOwner = await publicClient.readContract({
            address: safeWalletAddress,
            abi: safeAbi,
            functionName: "isOwner",
            args: [account.address],
            authorizationList: [],
        });

        if (!isOwner) {
            // 获取所有所有者列表以便调试
            const owners = await publicClient.readContract({
                address: safeWalletAddress,
                abi: safeAbi,
                functionName: "getOwners",
                authorizationList: [],
            });
            throw new Error(
                `地址 ${account.address} 不是Safe钱包的所有者。\n` +
                `当前所有者列表: ${owners.join(", ")}\n` +
                `请确保使用的私钥对应的地址是Safe的所有者。`
            );
        }

        // 检查阈值
        const threshold = await publicClient.readContract({
            address: safeWalletAddress,
            abi: safeAbi,
            functionName: "getThreshold",
            authorizationList: [],
        });

        console.log(`[Redeem] 签名者 ${account.address} 是Safe的所有者`);
        console.log(`[Redeem] Safe阈值: ${threshold.toString()} (需要 ${threshold.toString()} 个签名)`);

        if (threshold > 1n) {
            throw new Error(
                `Safe钱包需要 ${threshold.toString()} 个签名，但当前只提供了一个签名。\n` +
                `请确保提供足够数量的签名，或者使用阈值为1的Safe钱包。`
            );
        }

        // 3. 构建Safe交易参数
        const to = ctfAddress;
        const value = BigInt(0);
        const data = redeemData;
        const operation = 0; // 0 = Call, 1 = DelegateCall
        const safeTxGas = BigInt(0); // 设置为0，让Safe自动计算
        const baseGas = BigInt(0);
        const gasPrice = BigInt(0);
        const gasToken = "0x0000000000000000000000000000000000000000" as Address;
        const refundReceiver = "0x0000000000000000000000000000000000000000" as Address;

        // 4. 获取交易哈希
        const txHash = await publicClient.readContract({
            address: safeWalletAddress,
            abi: safeAbi,
            functionName: "getTransactionHash",
            args: [
                to,
                value,
                data,
                operation,
                safeTxGas,
                baseGas,
                gasPrice,
                gasToken,
                refundReceiver,
                nonce,
            ],
            authorizationList: [],
        });

        console.log(`[Redeem] 交易哈希: ${txHash}`);

        // 5. 签名交易哈希
        const signatureObj = await sign({
            hash: txHash,
            privateKey: this.config.privKey as Hex,
        });

        // 将签名对象转换为Safe期望的格式
        // Safe的签名格式：r(32字节) + s(32字节) + v(1字节) = 65字节
        // v值需要是27或28（recovery id）
        // 注意：viem的sign函数返回的v可能是0或1（EIP-2098格式），需要转换为27或28
        let v = signatureObj.v;
        if (v === 0n || v === 1n) {
            // EIP-2098格式，转换为传统格式
            v = v === 0n ? 27n : 28n;
        }
        
        // 构建签名：r + s + v
        const signature = concat([
            pad(signatureObj.r, { size: 32 }),
            pad(signatureObj.s, { size: 32 }),
            pad(toHex(v), { size: 1 }),
        ]) as Hex;

        console.log(`[Redeem] 签名: ${signature}`);
        console.log(`[Redeem] 签名长度: ${(signature.length - 2) / 2} 字节 (应该是65字节)`);
        console.log(`[Redeem] 签名r: ${signatureObj.r}`);
        console.log(`[Redeem] 签名s: ${signatureObj.s}`);
        console.log(`[Redeem] 签名v: ${v.toString()}`);

        // 6. 执行交易
        // signature格式：r(32字节) + s(32字节) + v(1字节) = 65字节
        console.log(`[Redeem] 准备执行交易...`);
        console.log(`[Redeem] 目标地址: ${to}`);
        console.log(`[Redeem] 数据长度: ${data.length} 字符`);
        
        let hash: Hex;
        try {
            hash = await walletClient.writeContract({
                address: safeWalletAddress,
                abi: safeAbi,
                functionName: "execTransaction",
                args: [
                    to,
                    value,
                    data,
                    operation,
                    safeTxGas,
                    baseGas,
                    gasPrice,
                    gasToken,
                    refundReceiver,
                    signature,
                ],
                account: account,
                chain: polygon,
            });

            logInfo(`[Redeem] 交易已提交，交易哈希: ${hash}`);
        } catch (error: any) {
            console.error(`❌ 执行交易时出错:`);
            console.error(`错误信息: ${error}`);
            if (error.message?.includes('GS026')) {
                console.error(`\nGS026 错误通常表示签名验证失败。可能的原因：`);
                console.error(`1. 签名者地址 ${account.address} 不是Safe的所有者`);
                console.error(`2. 签名格式不正确`);
                console.error(`3. 签名与交易哈希不匹配`);
                console.error(`4. Safe钱包需要多个签名，但只提供了一个`);
            }
            throw error;
        }

        // 7. 等待交易确认
        logInfo(`[Redeem] 等待交易确认...`);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        if (receipt.status === "success") {
            logInfo(`[Redeem] ✅ Redeem操作成功完成！`);
            logInfo(`[Redeem] 交易哈希: ${hash}`);
            logInfo(`[Redeem] 区块号: ${receipt.blockNumber}`);
        } else {
            console.error(`❌ Redeem操作失败！`);
            console.error(`交易哈希: ${hash}`);
            throw new Error("交易执行失败");
        }

        return {
            success: receipt.status === "success",
            hash,
            receipt,
        };
    }


    public async redeemAll(funderAddress: string) {
        const positions = await getGammaDataModule().getRedeemablePositions({ funderAddress });

        try {
            logInfo(`[Redeem] 有 ${positions.length} 个仓位, 等待赎回...`);
            for (let i = 0; i < positions.length; i++) {
                const position = positions[i];
                logInfo(`[Redeem] 开始赎回第${i + 1}个仓位: ${position.conditionId}`);
                const result = await this.redeemViaAAWallet(position.conditionId);
                if (result.success) {
                    logInfo(`[Redeem] 赎回成功: ${position.conditionId}`);
                } else {
                    logInfo(`[Redeem] 赎回失败: ${position.conditionId}`);
                }
            }
        } catch (error) {
            logError(`[Redeem] 赎回失败: ${error}`);
        }
        logInfo(`[Redeem] 赎回完成`);
    }
}

// 导出单例实例的便捷访问方法
export const getRedeemModule = () => Redeem.getInstance();


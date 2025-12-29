import { redeemWithRelayer } from "@crypto15min/utils/relayerRedeem";
import { getEncryptedConfig, syncConfig } from "@shared/encryptConfig";

export const debug = async () => {
  // 测试加密配置功能
  try {
    console.log("=== 开始测试加密配置功能 ===\n");

    // 1. 测试 syncConfig：加密 keyConfig.json
    console.log("1. 测试 syncConfig - 加密配置文件...");
    syncConfig();
    console.log("✓ syncConfig 执行成功\n");

    // 2. 测试 getConfig：读取加密后的配置
    console.log("2. 测试 getConfig - 读取加密配置...");

    // 测试读取顶层字段
    const privKey = getEncryptedConfig("privKey");
    console.log("✓ privKey:", privKey ? `${privKey.substring(0, 10)}...` : "undefined");

    // 测试读取嵌套字段
    const clobKey = getEncryptedConfig("clobCreds.key");
    console.log("✓ clobCreds.key:", clobKey || "undefined");

    const clobSecret = getEncryptedConfig("clobCreds.secret");
    console.log(
      "✓ clobCreds.secret:",
      clobSecret ? `${clobSecret.substring(0, 10)}...` : "undefined"
    );

    const credsKey = getEncryptedConfig("creds.key");
    console.log("✓ creds.key:", credsKey || "undefined");

    // 测试读取不存在的字段
    const notExist = getEncryptedConfig("notExist");
    console.log("✓ notExist:", notExist === undefined ? "undefined (正确)" : "存在 (异常)");

    console.log("\n=== 加密配置功能测试完成 ===\n");
  } catch (error) {
    console.error("测试失败:", error instanceof Error ? error.message : error);
    throw error;
  }

  // 原有的测试代码（已注释）
  // const globalConfig = getGlobalConfig();
  // const position = await getGammaDataModule().getExpired30MinPositions({ funderAddress: globalConfig.account.funderAddress });
  // await getRedeemModule().redeemWithEOA('0x181da7d7f70175f441367edc635c0d56ddb428ca1199a3ec71d4f6273b12eac3');
  // await redeemWithRelayer("0xe2a985ff57de4d7c3589871781081c95a0b722c41f4cf24899402982aadca002");
};

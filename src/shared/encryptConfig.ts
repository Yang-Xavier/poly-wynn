import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

// 加密算法配置
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // GCM 模式需要 12 字节 IV，但为了兼容性使用 16
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32; // AES-256 需要 32 字节密钥

// 获取项目根目录（src 的父目录）
const PROJECT_ROOT = path.resolve(__dirname, "../..");
// 加密后的配置文件路径（保存在项目根目录）
const ENCRYPTED_CONFIG_PATH = path.join(PROJECT_ROOT, "config.encrypted.json");
// 源配置文件路径（src/config.json）
const SOURCE_CONFIG_PATH = path.join(PROJECT_ROOT, "keyConfig.json");

/**
 * 从环境变量获取加密密钥
 * @returns 加密密钥（32字节）
 */
function getEncryptionKey(): Buffer {
  const envKey = process.env.PASSWORD;
  if (!envKey) {
    throw new Error("环境变量 ENCRYPTION_KEY 未设置");
  }

  // 如果密钥是 hex 字符串，直接转换
  if (/^[0-9a-fA-F]{64}$/.test(envKey)) {
    return Buffer.from(envKey, "hex");
  }

  // 否则使用 PBKDF2 派生密钥（从任意字符串生成固定长度密钥）
  return crypto.pbkdf2Sync(envKey, "poly-wynn-salt", 100000, KEY_LENGTH, "sha256");
}

/**
 * 加密数据
 * @param text 要加密的文本
 * @param key 加密密钥
 * @returns 加密后的数据（格式: iv:tag:encrypted）
 */
function encrypt(text: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const tag = cipher.getAuthTag();

  // 返回格式: iv:tag:encrypted
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

/**
 * 解密数据
 * @param encryptedData 加密的数据（格式: iv:tag:encrypted）
 * @param key 解密密钥
 * @returns 解密后的文本
 */
function decrypt(encryptedData: string, key: Buffer): string {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) {
    throw new Error("加密数据格式错误");
  }

  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * 读取加密的配置文件并获取指定字段的值
 * @param name 配置字段名（可选，支持嵌套路径，如 "account.walletAddress"）。如果不传，则返回整个配置对象
 * @returns 配置值或整个配置对象
 */
export function getEncryptedConfig(name?: string): any {
  try {
    // 检查加密文件是否存在
    if (!fs.existsSync(ENCRYPTED_CONFIG_PATH)) {
      throw new Error(`加密配置文件不存在: ${ENCRYPTED_CONFIG_PATH}`);
    }

    // 读取加密文件
    const encryptedData = fs.readFileSync(ENCRYPTED_CONFIG_PATH, "utf8");
    if (!encryptedData.trim()) {
      throw new Error("加密配置文件为空");
    }

    // 获取密钥并解密
    const key = getEncryptionKey();
    const decryptedText = decrypt(encryptedData, key);

    // 解析 JSON
    const config = JSON.parse(decryptedText) as TEncryptedConfig;

    // 如果没有提供 name，返回整个配置对象
    if (!name) {
      return config;
    }

    // 支持嵌套路径访问，如 "account.walletAddress"
    const keys = name.split(".");
    let value = config;
    for (const key of keys) {
      if (value === null || value === undefined) {
        return undefined;
      }
      value = value[key];
    }

    return value;
  } catch (error) {
    if (error instanceof Error) {
      const errorMsg = name
        ? `获取配置失败 (${name}): ${error.message}`
        : `获取配置失败: ${error.message}`;
      throw new Error(errorMsg);
    }
    throw error;
  }
}

/**
 * 同步配置文件：读取 config.json，加密后写入到加密文件
 */
export function syncConfig(): void {
  try {
    // 检查源配置文件是否存在
    if (!fs.existsSync(SOURCE_CONFIG_PATH)) {
      throw new Error(`源配置文件不存在: ${SOURCE_CONFIG_PATH}`);
    }

    // 读取源配置文件
    const configData = fs.readFileSync(SOURCE_CONFIG_PATH, "utf8");
    if (!configData.trim()) {
      throw new Error("源配置文件为空");
    }

    // 验证 JSON 格式
    JSON.parse(configData);

    // 获取密钥并加密
    const key = getEncryptionKey();
    const encryptedData = encrypt(configData, key);

    // 确保目录存在
    const dir = path.dirname(ENCRYPTED_CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 写入加密文件
    fs.writeFileSync(ENCRYPTED_CONFIG_PATH, encryptedData, "utf8");

    console.log(`配置文件已成功加密并保存到: ${ENCRYPTED_CONFIG_PATH}`);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`同步配置失败: ${error.message}`);
    }
    throw error;
  }
}

export type TCreds = {
  key: string;
  secret: string;
  passphrase: string;
};

export type TAccountConfig = {
  email: string;
  walletAddress: string;
  funderAddress: string;
  privKey: string;
  clobCreds: TCreds;
};

export type TEncryptedConfig = {
  apiAuth: {
    binance: {
      apiKey: string;
      apiSecret: string;
    };
  };
  account1: TAccountConfig;
  account2: TAccountConfig;
};

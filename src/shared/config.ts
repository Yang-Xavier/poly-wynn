import { getEncryptedConfig } from "@shared/encryptConfig";

/**
 * 获取全局配置对象
 * @returns {typeof import('../config').globalConfig}
 */
export function getGlobalConfig() {
  // 从json文件中读取config
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const config = require("./globalConfig.json");
  return config;
}

export function getKeyConfig() {
  // 从json文件中读取config
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const config = getEncryptedConfig();
  return config;
}

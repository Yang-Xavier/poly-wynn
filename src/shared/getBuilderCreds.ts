import { getEncryptedConfig, TCreds } from "./encryptConfig";

let builderIndex = 0;

export const getBuilderCreds = (): { builderCreds: TCreds; builderIndex: number } => {
  const encryptedConfig = getEncryptedConfig();
  const builderCreds = encryptedConfig.builders[builderIndex];
  builderIndex++;
  if (builderIndex >= encryptedConfig.builders.length) {
    builderIndex = 0;
  }
  return { builderCreds, builderIndex };
};

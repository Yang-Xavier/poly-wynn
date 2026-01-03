import { Wallet } from "@ethersproject/wallet";
import { ClobClient } from "@polymarket/clob-client";
import { CLOB_HOST, FUNDER_ADDRESS } from "@shared/constants";
import { getEncryptedConfig } from "@shared/encryptConfig";

let clobClient;

export default {
  init: async () => {
    const { clobCreds, privKey } = getEncryptedConfig();
    const signatureType = 1;
    const signer = new Wallet(privKey);
    clobClient = new ClobClient(CLOB_HOST, 137, signer, clobCreds, signatureType, FUNDER_ADDRESS);
    await clobClient.getOk();
  },
};

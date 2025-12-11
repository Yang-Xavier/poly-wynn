import { redeemWithRelayer } from "./utils/relayerRedeem";

export const debug = async () => {
        // const globalConfig = getGlobalConfig();
        // const position = await getGammaDataModule().getExpired30MinPositions({ funderAddress: globalConfig.account.funderAddress });
        // await getRedeemModule().redeemWithEOA('0x181da7d7f70175f441367edc635c0d56ddb428ca1199a3ec71d4f6273b12eac3');
        await redeemWithRelayer("0xe2a985ff57de4d7c3589871781081c95a0b722c41f4cf24899402982aadca002");
}
import { getGlobalConfig } from "@utils/config";
import { getRedeemModule } from "./module/redeem";

export const redeem = async () => {
    const globalConfig = getGlobalConfig();
    const redeemModule = getRedeemModule();
    await redeemModule.redeemAll(globalConfig.account.funderAddress);
}
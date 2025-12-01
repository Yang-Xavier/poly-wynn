import { getRedeemModule } from "./module/redeem";

export const redeem = async (conditionId: string) => {
    const redeemModule = getRedeemModule();
    await redeemModule.redeemViaAAWallet(conditionId);
}
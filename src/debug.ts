import { getGammaDataModule } from "./module/gammaData";
import { getGlobalConfig } from "@utils/config";
import { sellExpired30MinPostions } from "./module/trade";
import { getClobModule } from "./module/clob";
import { getRedeemModule } from "./module/redeem";

export const debug = async () => {
        // const globalConfig = getGlobalConfig();
        // const position = await getGammaDataModule().getExpired30MinPositions({ funderAddress: globalConfig.account.funderAddress });
        await getRedeemModule().redeemViaAAWallet('0x2369ecbad3c821386fc0b716e31c809fb23d23f7b5b06956e889d3f54d8da149');
}
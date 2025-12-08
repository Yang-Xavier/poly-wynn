import { getGammaDataModule } from "./module/gammaData";
import { getGlobalConfig } from "@utils/config";
import { sellExpired30MinPostions } from "./module/trade";
import { getClobModule } from "./module/clob";

export const debug = async () => {
        // const globalConfig = getGlobalConfig();
        // const position = await getGammaDataModule().getExpired30MinPositions({ funderAddress: globalConfig.account.funderAddress });
        await getClobModule().init()
        await sellExpired30MinPostions();
}
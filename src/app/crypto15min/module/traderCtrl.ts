import { getConfig } from "@crypto15min/utils/config";
import { TRADE_ACTION_ENUM } from "@shared/constants";
import Trader, { TraderConfig } from "@shared/trade/Trader";
import { TradeTask } from "@shared/trade/TradeTaskManage";

class TraderCtrl extends Trader {
  isSold: boolean = false;

  constructor(config: TraderConfig) {
    super(config);
  }

  getTradeLimitation() {
    const config = getConfig();
    const positionSize = this.position.getPosition().size;

    const canBuy =
      this.remainAmount >= config.stratgegy.buyMinimumAmount &&
      this.tradeTaskManage.getRunningTaskAction() === null &&
      !this.isSold;

    const canSell =
      positionSize >= config.stratgegy.sellMinimumSize &&
      this.tradeTaskManage.getRunningTaskAction() === null &&
      !!this.position.getPosition().outcome;

    return { canBuy, canSell };
  }

  onTrade(task: TradeTask) {
    if (task.action === TRADE_ACTION_ENUM.sell) {
      this.isSold = true;
    }
  }
}

let trader: TraderCtrl;

export const initTrader = (config: TraderConfig) => {
  trader = new TraderCtrl(config);
};

export const getTrader = () => {
  return trader;
};

import Trader, { TraderConfig } from "@shared/trade/Trader";
import { getConfig } from "./config";
import { TradeTask } from "@shared/trade/TradeTaskManage";
import { TRADE_ACTION_ENUM } from "@shared/constants";

class TraderCtrl extends Trader {
  buyCount: number = 0;

  getTradeLimitation() {
    const config = getConfig();
    const canBuy =
      this.remainAmount >= config.minBuyAmount &&
      this.tradeTaskManage.getRunningTaskAction() === null &&
      this.buyCount < config.maxBuyCount;

    const canSell =
      this.position.getPosition().size >= config.minSellSize &&
      this.tradeTaskManage.getRunningTaskAction() === null &&
      !!this.position.getPosition().outcome;

    return { canBuy, canSell };
  }

  onTrade(task: TradeTask) {
    if (task.action === TRADE_ACTION_ENUM.buy) {
      this.buyCount++;
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

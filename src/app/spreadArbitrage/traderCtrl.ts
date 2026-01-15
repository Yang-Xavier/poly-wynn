import Trader, { TraderConfig } from "@shared/trade/Trader";
import { getConfig } from "./config";
import { TradeTask } from "@shared/trade/TradeTaskManage";
import { OUTCOMES_ENUM, TRADE_ACTION_ENUM } from "@shared/constants";
import { TBriefOrder } from "@shared/trade/TradeCore";
export interface IChance {
  assetId: string;
  outcome: OUTCOMES_ENUM;
  buyPrice: number;
  stopProfitPrice: number;
  stopLossPrice: number;
  isBought: boolean;
}

class TraderCtrl extends Trader {
  chance: IChance | null = null;
  tradeCount: number = 0;

  constructor(traderConfig: TraderConfig) {
    const config = getConfig();

    super({
      calcTradeLimitation: () => {
        const canBuy =
          this.remainAmount >= config.minBuyAmount &&
          this.tradeTaskManage.getRunningTaskAction() === null &&
          this.tradeCount < config.maxBuyCount;

        const canSell =
          this.position.getPosition().size >= config.minSellSize &&
          !!this.chance &&
          this.tradeTaskManage.getRunningTaskAction() === null &&
          !!this.position.getPosition().outcome;

        return { canBuy, canSell };
      },
      onTradeTaskFinished: (task: TradeTask, order: TBriefOrder | null) => {
        if (order) {
          if (task.action === TRADE_ACTION_ENUM.buy) {
            if (this.remainAmount < config.minBuyAmount) {
              this.setChance({
                ...this.chance,
                isBought: true,
              });
            }
          } else if (task.action === TRADE_ACTION_ENUM.sell) {
            if (this.position.getPosition().size < config.minSellSize) {
              this.setChance(null);
              this.tradeCount++;
            }
          }
        }
      },
      ...traderConfig,
    });
  }

  setChance(chance: IChance) {
    this.chance = chance;
  }

  getChance() {
    return this.chance;
  }
}

let trader: TraderCtrl;

export const initTrader = (config: TraderConfig) => {
  trader = new TraderCtrl(config);
};

export const getTrader = () => {
  return trader;
};

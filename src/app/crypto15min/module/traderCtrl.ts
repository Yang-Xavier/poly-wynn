import { getConfig } from "@crypto15min/utils/config";
import { calcAttenuation } from "@shared/algorithm/calcAttenuation";
import { TRADE_ACTION_ENUM } from "@shared/constants";
import { TBriefOrder } from "@shared/trade/TradeCore";
import Trader, { TraderConfig } from "@shared/trade/Trader";
import { TradeTask } from "@shared/trade/TradeTaskManage";
import { distanceToNextInterval } from "@shared/utils/market";

class TraderCtrl extends Trader {
  isSold: boolean = false;

  constructor(config: TraderConfig) {
    super({
      ...config,
      calcTradeLimitation: () => {
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
      },
      onTradeTaskFinished: (task: TradeTask) => {
        if (task.action === TRADE_ACTION_ENUM.sell) {
          this.isSold = true;
        }
      },
    });
  }

  calcBuyMaxAmountWithTimeFactor(slugIntervalTimestamp: number) {
    const config = getConfig();
    const balance = this.getBalance();
    const acceptMaxPositionAmountFactor = calcAttenuation(
      [
        [...config.stratgegy.buyPositionReduceFactorRange].sort((a, b) => a - b), // 从小到大
        [config.stratgegy.startStrategyBefore, 0].sort((a, b) => a - b), // 从小到大
      ],
      Math.min(distanceToNextInterval(slugIntervalTimestamp), config.stratgegy.startStrategyBefore),
      2,
      0.8
    );
    const maxBuyAmount = Math.min(
      Number((balance * (1 - acceptMaxPositionAmountFactor)).toFixed(2)),
      config.stratgegy.buyingMaxAmount
    );
    this.setMaxTradeAmount(maxBuyAmount);
    return maxBuyAmount;
  }
}

let trader: TraderCtrl;

export const initTrader = (config: TraderConfig) => {
  trader = new TraderCtrl(config);
};

export const getTrader = () => {
  return trader;
};

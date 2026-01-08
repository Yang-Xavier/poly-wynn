import TradeReport from "@shared/TradeReport";

class Crypto15minTradeReport extends TradeReport {
  constructor() {
    super(process.env.MARKET ? `crypto15min-${process.env.MARKET}` : "crypto15min");
  }

  calcProfit() {
    if (this.traceReport.result === "won") {
      return this.traceReport.trades.reduce(
        (acc, trade) => acc + trade.amount * (1 - trade.price),
        0
      );
    } else if (this.traceReport.result === "lost") {
      return this.traceReport.trades.reduce((acc, trade) => acc - trade.amount * trade.price, 0);
    } else if (this.traceReport.result === "sold") {
      return super.calcProfit();
    } else {
      return 0;
    }
  }
}

export default new Crypto15minTradeReport();

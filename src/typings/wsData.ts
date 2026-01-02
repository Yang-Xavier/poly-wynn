// 推送数据接口
export interface IMarketPushData {
  market: string;
  asset_id: string;
  bids: {
    price: string;
    size: string;
  }[];
  asks: {
    price: string;
    size: string;
  }[];
  event_type: "book";
  hash: string;
  timestamp: string;
}

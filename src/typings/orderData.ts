export type IOrderData = {
  id: string;
  status: string;
  owner: string;
  maker_address: string;
  market: string;
  asset_id: string;
  side: string;
  original_size: string;
  size_matched: string;
  price: string;
  outcome: string;
  expiration: string;
  order_type: string;
  associate_trades: string[];
  created_at: number;
};

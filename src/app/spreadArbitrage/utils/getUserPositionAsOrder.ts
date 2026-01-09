import dataApi from "@shared/api/dataApi";

export const getUserpostionByMarketAsOrder = async (market: string, user: string) => {
  const positions = await dataApi.getPositions({
    user: user,
    market: [market],
    limit: 1000,
  });
  return positions.map((position) => {
    return {
      id: "",
      status: "MATCHED",
      owner: position.proxyWallet,
      maker_address: position.proxyWallet,
      market: position.conditionId,
      asset_id: position.asset,
      side: "",
      original_size: position.size.toString(),
      size_matched: position.size.toString(),
      price: position.avgPrice.toString(),
      outcome: position.outcome,
      expiration: "",
      order_type: "",
      associate_trades: [],
      created_at: 0,
    };
  });
};

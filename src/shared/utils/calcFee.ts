export const calcFee = ({ price, matchedAmount }: { price: number; matchedAmount: string }) => {
  const feeRate = 0.25 * (price * (1 - price)) ** 2;
  const fee = Number(matchedAmount) * feeRate;
  return fee;
};

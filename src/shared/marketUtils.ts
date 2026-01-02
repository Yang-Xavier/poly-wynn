// 计算当前时间属于哪个15分钟区间，并返回该区间开始的时间戳（单位：秒）
// 支持传入参数 n，获取下 n 个 interval（n 默认为 0，表示当前 interval）
export const get15MinIntervalTimestamp = (n: number = 0) => {
  const now = Date.now();
  const interval = 15 * 60 * 1000; // 15分钟对应的毫秒数
  const intervalStart = now - (now % interval) + n * interval;
  return Math.floor(intervalStart / 1000); // 返回秒级时间戳
};

export const getMarketSlug15Min = (market: string, intervalTimestamp: number) => {
  return `${market}-updown-15m-${intervalTimestamp}`;
};

export const distanceToNextInterval = (intervalTimestamp: number) => {
  const now = Date.now();
  const interval = 15 * 60 * 1000;
  const nextIntervalStart = intervalTimestamp * 1000 + interval;
  const msUntilNextInterval = nextIntervalStart - now;
  return Math.max(msUntilNextInterval, 0);
};

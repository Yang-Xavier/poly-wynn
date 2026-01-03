export const runIntervalFn = (
  fn: (context: { setInterval: (ms: number) => void }) => Promise<void>,
  interval: number = 0
) => {
  let currentInterval = interval;
  let stopped = false;

  const context = {
    setInterval: (ms: number) => {
      currentInterval = ms;
    },
  };

  const runner = async () => {
    while (!stopped) {
      await fn(context);
      await new Promise((resolve) => setTimeout(resolve, currentInterval));
    }
  };

  runner();

  return {
    stop: () => {
      stopped = true;
    },
    setInterval: (ms: number) => {
      currentInterval = ms;
    },
  };
};

export const race = async (promise: Promise<any>, timeout: number, onTimeout?: () => void) => {
  const timeoutPromise = new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve(onTimeout?.() ?? null);
    }, timeout);
  });
  const result = await Promise.race([promise, timeoutPromise]);
  return result;
};

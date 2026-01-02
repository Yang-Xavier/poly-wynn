export const waitFor = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms > 0 ? ms : 0));
};

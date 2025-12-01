export const to: <D = any>(
  asyncFn: Promise<D>
) => Promise<[undefined | unknown, D | undefined]> = async (asyncFn) => {
  try {
    return [undefined, await asyncFn];
  } catch (e) {
    return [e, undefined];
  }
};

export const awaitAxiosDataTo = async <D = any>(
  asyncFn: Promise<{ data: D }>
) => {
  const [error, resp] = await to<{ data: D }>(asyncFn);
  return [error, resp?.data] as [any, D | undefined];
};

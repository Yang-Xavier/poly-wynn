/**
 * limitGroupReqFrequency——分组共享频率的节流器：同组多个函数共用一次频率限制
 *
 * @param groupKey: string 标识同一批“频次共用”的逻辑，如同一API、市场等
 * @param fn: 要执行的异步函数
 * @param interval: 限制同一groupKey下所有函数的最小间隔，单位ms
 *
 * 用法举例：
 *    await limitGroupReqFrequency('orderBook-ETH', () => fetchBook(...), 1000)
 *    await limitGroupReqFrequency('orderBook-ETH', () => doAnotherThing(), 1000)
 * 这两个只要属于同一个groupKey（如'orderBook-ETH'），它们会以总共每interval毫秒一次为上限排队执行
 */

const groupLastExecMap: Map<string, number> = new Map();
const groupQueueMap: Map<string, Promise<unknown>> = new Map();

export async function limitGroupReqFrequency<T>(
    groupKey: string,
    fn: () => Promise<T>,
    interval: number
): Promise<T> {
    // 用Promise串行队列，保证即便并发调用也能限频且顺序执行
    const prior = groupQueueMap.get(groupKey) || Promise.resolve();

    let resolver: (x: void) => void;
    const chain = new Promise<void>(resolve => { resolver = resolve!; });

    groupQueueMap.set(groupKey, prior.then(() => chain));

    const doTask = async (): Promise<T> => {
        const now = Date.now();
        const lastExec = groupLastExecMap.get(groupKey) || 0;
        const wait = now - lastExec < interval ? interval - (now - lastExec) : 0;
        if (wait > 0) {
            await new Promise(res => setTimeout(res, wait));
        }
        const ret = await fn();
        groupLastExecMap.set(groupKey, Date.now());
        resolver(); // 标记本轮Promise链完成
        return ret;
    };

    return prior.then(doTask);
}


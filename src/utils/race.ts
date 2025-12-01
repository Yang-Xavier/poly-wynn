export const race = async (promise: Promise<any>, timeout: number) => {
    const timeoutPromise = new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve(null)
        }, timeout);
    });
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
}
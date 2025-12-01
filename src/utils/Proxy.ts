// import { logger } from '@utils/log';
import axios, { AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { logInfo } from '../module/logger';

// axios.interceptors.request.use((config) => {
//   logInfo(
//     `Send Request: ${config.method.toUpperCase()} ${config.url} params: ${JSON.stringify(config.params || {})} body: ${JSON.stringify(config.data || {})}`
//   );
//   return config;
// });

// axios.interceptors.response.use(
//   (resp) => {
//     logInfo(
//       `Get Response: ${resp.config.method.toUpperCase()} ${resp.config.url} data:${JSON.stringify(resp.data || {})}`
//     );
//     return resp;
//   },
//   (errorResp) => {
//     logInfo(
//       `Request Error! ${errorResp.config.url} status=${errorResp.status} data:${JSON.stringify(errorResp.data || {})}`
//     );
//     return Promise.reject(errorResp);
//   }
// );

export class Proxy {
  private maxRetryCount = 3;
  private retryDelay = 300; // 300ms

  constructor(maxRetryCount = 3, retryDelay = 1000) {
    this.maxRetryCount = maxRetryCount;
    this.retryDelay = retryDelay;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async retryRequest<T>(
    requestFn: () => Promise<T>,
    retryCount = 0
  ): Promise<T> {
    try {
      return await requestFn();
    } catch (error) {
      const axiosError = error as AxiosError;

      // 检查是否应该重试
      const shouldRetry =
        this.shouldRetry(axiosError) && retryCount < this.maxRetryCount;

      if (shouldRetry) {
        logInfo(
          `[Proxy] Request failed, retrying... (${retryCount + 1}/${this.maxRetryCount})`
        );
        await this.delay(this.retryDelay * Math.pow(2, retryCount)); // 指数退避
        return this.retryRequest(requestFn, retryCount + 1);
      }

      throw error;
    }
  }

  private shouldRetry(error: AxiosError): boolean {
    // 网络错误或5xx服务器错误时重试
    if (!error.response) {
      return true; // 网络错误
    }

    const status = error.response.status;
    return status >= 500 && status < 600; // 服务器错误
  }

  async get(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse> {
    return this.retryRequest(() => axios.get(url, config));
  }

  async post(
    url: string,
    data: any,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse> {
    return this.retryRequest(() => axios.post(url, data, config));
  }
}

export default new Proxy();

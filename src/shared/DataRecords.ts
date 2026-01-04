import * as fs from "fs";
import * as path from "path";

export interface DataRecordsConfig {
  appName: string; // 应用名称，必填
  bufferSize?: number; // 缓冲区大小，达到此数量时触发写入，默认 100
  flushInterval?: number; // 刷新间隔（毫秒），默认 5000
  dataDir?: string; // 数据目录，默认为 './data'
}

// 默认配置
const DEFAULT_CONFIG: Required<Omit<DataRecordsConfig, "appName">> = {
  bufferSize: 100,
  flushInterval: 5000,
  dataDir: "./data",
};

// 缓冲区数据项
interface BufferItem {
  dataName: string;
  traceId: string;
  serializedData: string; // 已序列化的数据
}

/**
 * 数据记录器 - 用于批量记录数据到文件
 *
 * 特性：
 * - 支持按 appName、date、traceId_dataName 组织文件结构
 * - 文件路径：data/appName/date/traceId_dataName.data
 * - 使用缓冲区机制，达到一定数量或时间间隔时批量写入
 * - 日期按北京时间（UTC+8）计算
 * - 支持清理旧数据
 */
export class DataRecords {
  private config: Required<DataRecordsConfig>;
  private traceId: string = "";
  private buffer: BufferItem[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing: boolean = false;
  private fileStreams: Map<string, fs.WriteStream> = new Map(); // 存储不同文件的写入流
  private streamDates: Map<string, string> = new Map(); // 存储每个流的当前日期

  constructor(config: DataRecordsConfig) {
    if (!config.appName) {
      throw new Error("appName 是必填参数");
    }
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 确保数据目录存在
    if (!fs.existsSync(this.config.dataDir)) {
      fs.mkdirSync(this.config.dataDir, { recursive: true });
    }

    // 启动自动刷新定时器
    this.startAutoFlush();
  }

  /**
   * 获取当前日期的文件夹名称（格式：YYYY-MM-DD）
   * 按照北京时区（UTC+8）进行划分
   */
  private getDateFolderName(): string {
    const now = new Date();
    // 转换为北京时区（UTC+8）
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    // 使用 UTC 方法获取北京时区的年月日
    const year = beijingTime.getUTCFullYear();
    const month = String(beijingTime.getUTCMonth() + 1).padStart(2, "0");
    const day = String(beijingTime.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /**
   * 获取数据文件的完整路径
   * 目录结构：data/appName/date/traceId_dataName.data
   */
  private getDataFilePath(dateFolder: string, dataName: string, traceId: string): string {
    // appName 目录
    const appNameDir = path.join(this.config.dataDir, this.config.appName);
    // 日期目录
    const dateDir = path.join(appNameDir, dateFolder);
    // 确保日期目录存在
    if (!fs.existsSync(dateDir)) {
      fs.mkdirSync(dateDir, { recursive: true });
    }
    // 文件名：traceId_dataName.data
    const fileName = `${traceId}_${dataName}.data`;
    return path.join(dateDir, fileName);
  }

  /**
   * 生成文件流的唯一键
   */
  private getStreamKey(dataName: string, traceId: string): string {
    return `${dataName}_${traceId}`;
  }

  /**
   * 获取或创建指定文件的写入流
   */
  private getOrCreateFileStream(dataName: string, traceId: string): fs.WriteStream {
    const streamKey = this.getStreamKey(dataName, traceId);
    const date = this.getDateFolderName();
    const currentDate = this.streamDates.get(streamKey);

    // 如果日期变化或文件流不存在，需要重新创建
    if (!currentDate || currentDate !== date || !this.fileStreams.has(streamKey)) {
      // 如果已存在文件流，先关闭它
      const existingStream = this.fileStreams.get(streamKey);
      if (existingStream) {
        existingStream.end();
      }

      // 创建新的文件流
      const filePath = this.getDataFilePath(date, dataName, traceId);
      const newStream = fs.createWriteStream(filePath, { flags: "a" });
      this.fileStreams.set(streamKey, newStream);
      this.streamDates.set(streamKey, date);
      return newStream;
    }

    return this.fileStreams.get(streamKey)!;
  }

  /**
   * 启动自动刷新定时器
   */
  private startAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flushTimer = setInterval(() => {
      if (this.buffer.length > 0 && !this.isFlushing) {
        this.flush();
      }
    }, this.config.flushInterval);
  }

  /**
   * 设置 traceId
   */
  setTraceId(traceId: string): void {
    const oldTraceId = this.traceId;
    if (oldTraceId === traceId) {
      return; // traceId 没有变化，不需要做任何处理
    }

    this.traceId = traceId;

    // 如果 traceId 变化，需要先刷新缓冲区，然后关闭旧的文件流
    if (oldTraceId && this.buffer.length > 0) {
      // 临时设置回旧的 traceId 以刷新旧数据
      this.traceId = oldTraceId;
      this.flush();
      this.traceId = traceId;
    }

    // 关闭所有与旧 traceId 相关的文件流
    const streamsToClose: string[] = [];
    for (const streamKey of this.fileStreams.keys()) {
      // streamKey 格式：dataName_traceId
      // 需要从后面解析以正确分离 traceId（因为 dataName 可能包含下划线）
      const lastUnderscoreIndex = streamKey.lastIndexOf("_");
      if (lastUnderscoreIndex === -1) {
        continue;
      }
      const streamTraceId = streamKey.substring(lastUnderscoreIndex + 1);
      if (oldTraceId && streamTraceId === oldTraceId) {
        streamsToClose.push(streamKey);
      }
    }

    for (const streamKey of streamsToClose) {
      const stream = this.fileStreams.get(streamKey);
      if (stream) {
        stream.end();
        this.fileStreams.delete(streamKey);
        this.streamDates.delete(streamKey);
      }
    }
  }

  /**
   * 记录数据
   * @param dataName 数据名称
   * @param data 要记录的数据对象
   */
  record(dataName: string, data: any): void {
    if (!this.traceId) {
      throw new Error("请先调用 setTraceId 设置 traceId");
    }

    // 序列化数据
    let serializedData: string;
    try {
      serializedData = JSON.stringify(data);
    } catch (error) {
      throw new Error(`数据序列化失败: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 添加到缓冲区
    this.buffer.push({
      dataName,
      traceId: this.traceId,
      serializedData,
    });

    // 如果缓冲区达到指定大小，立即刷新
    if (this.buffer.length >= this.config.bufferSize) {
      if (!this.isFlushing) {
        this.flush();
      }
    }
  }

  /**
   * 刷新缓冲区，将数据写入文件
   */
  private flush(): void {
    if (this.isFlushing || this.buffer.length === 0) {
      return;
    }

    this.isFlushing = true;

    // 使用 setImmediate 确保在下一个事件循环中执行，不阻塞主线程
    setImmediate(() => {
      try {
        // 按 (dataName, traceId) 分组数据
        const groupedData = new Map<string, string[]>();

        for (const item of this.buffer) {
          const streamKey = this.getStreamKey(item.dataName, item.traceId);
          if (!groupedData.has(streamKey)) {
            groupedData.set(streamKey, []);
          }
          groupedData.get(streamKey)!.push(item.serializedData);
        }

        // 清空缓冲区
        this.buffer = [];

        // 写入文件
        let hasBackpressure = false;
        for (const [streamKey, dataList] of groupedData.entries()) {
          // streamKey 格式：dataName_traceId
          // 需要从后面解析以正确分离 traceId（因为 dataName 可能包含下划线）
          const lastUnderscoreIndex = streamKey.lastIndexOf("_");
          if (lastUnderscoreIndex === -1) {
            continue;
          }
          const dataName = streamKey.substring(0, lastUnderscoreIndex);
          const traceId = streamKey.substring(lastUnderscoreIndex + 1);
          const stream = this.getOrCreateFileStream(dataName, traceId);

          // 将数据写入文件，每行一个数据
          const content = dataList.map((data) => data + "\n").join("");
          const canWrite = stream.write(content);

          // 如果写入缓冲区已满，等待 drain 事件
          if (!canWrite) {
            hasBackpressure = true;
            // 设置 drain 事件监听器，等待缓冲区有空间后继续
            stream.once("drain", () => {
              this.isFlushing = false;
              // 继续刷新，处理可能新加入的数据
              if (this.buffer.length > 0) {
                this.flush();
              }
            });
            // 跳出循环，等待 drain 事件
            break;
          }
        }

        // 如果没有遇到背压，重置刷新状态
        if (!hasBackpressure) {
          this.isFlushing = false;
        }
      } catch (error) {
        console.error("数据写入失败:", error);
        this.isFlushing = false;
      }
    });
  }

  /**
   * 手动刷新缓冲区
   */
  async flushNow(): Promise<void> {
    return new Promise((resolve) => {
      if (this.buffer.length === 0) {
        resolve();
        return;
      }

      // 如果正在刷新，等待完成
      if (this.isFlushing) {
        const checkInterval = setInterval(() => {
          if (!this.isFlushing) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 10);
        return;
      }

      this.flush();

      // 等待刷新完成
      const checkInterval = setInterval(() => {
        if (!this.isFlushing && this.buffer.length === 0) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 10);
    });
  }

  /**
   * 获取当前 traceId
   */
  getTraceId(): string {
    return this.traceId;
  }

  /**
   * 清理指定天数之前的数据
   * @param days 保留最近N天的数据，N天之前的数据将被删除
   * @returns 返回被删除的日期文件夹数量
   */
  cleanOldData(days: number): number {
    if (days < 0) {
      throw new Error("days参数必须大于等于0");
    }

    // 如果数据目录不存在，直接返回
    if (!fs.existsSync(this.config.dataDir)) {
      return 0;
    }

    // 先刷新缓冲区，确保所有数据都已写入
    this.flushNow();

    // 获取北京时区的当前日期（UTC+8）
    const now = new Date();
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    // 设置为北京时区当天的0点（UTC时间）
    const currentDate = new Date(
      Date.UTC(
        beijingTime.getUTCFullYear(),
        beijingTime.getUTCMonth(),
        beijingTime.getUTCDate(),
        0,
        0,
        0,
        0
      )
    );
    // 转换回UTC时间戳（减去8小时偏移）
    const beijingMidnight = currentDate.getTime() - 8 * 60 * 60 * 1000;
    const cutoffTime = beijingMidnight - days * 24 * 60 * 60 * 1000; // 截止时间戳

    let deletedCount = 0;
    const currentDateFolder = this.getDateFolderName();

    try {
      // 读取数据目录下的 appName 目录
      const appNamePath = path.join(this.config.dataDir, this.config.appName);
      if (!fs.existsSync(appNamePath)) {
        return 0;
      }

      // 读取 appName 目录下的所有文件和文件夹（日期目录）
      const dateEntries = fs.readdirSync(appNamePath, { withFileTypes: true });

      for (const dateEntry of dateEntries) {
        // 只处理目录（日期目录）
        if (!dateEntry.isDirectory()) {
          continue;
        }

        const folderName = dateEntry.name;
        // 检查文件夹名称是否符合日期格式 YYYY-MM-DD
        const dateMatch = folderName.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!dateMatch) {
          // 如果不是日期格式的文件夹，跳过
          continue;
        }

        // 如果是当前使用的数据文件夹，跳过
        if (folderName === currentDateFolder) {
          continue;
        }

        // 解析日期（按北京时区解析）
        const year = parseInt(dateMatch[1], 10);
        const month = parseInt(dateMatch[2], 10) - 1; // 月份从0开始
        const day = parseInt(dateMatch[3], 10);

        // 创建北京时区当天的0点（使用UTC时间表示）
        const folderDate = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
        // 转换为UTC时间戳（减去8小时偏移，使其对应北京时区的0点）
        const folderDateUTC = folderDate.getTime() - 8 * 60 * 60 * 1000;

        // 如果文件夹日期早于截止时间，删除该文件夹
        if (folderDateUTC < cutoffTime) {
          const folderPath = path.join(appNamePath, folderName);

          try {
            // 递归删除文件夹及其内容
            fs.rmSync(folderPath, { recursive: true, force: true });
            deletedCount++;
            console.log(`已删除旧数据文件夹: ${this.config.appName}/${folderName}`);
          } catch (error) {
            console.error(`删除数据文件夹失败: ${this.config.appName}/${folderName}`, error);
          }
        }
      }
    } catch (error) {
      console.error("清理旧数据时发生错误", error);
      throw error;
    }

    return deletedCount;
  }

  /**
   * 关闭所有文件流并清理资源
   */
  close(): void {
    // 停止自动刷新定时器
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // 刷新所有剩余的数据
    this.flushNow();

    // 关闭所有文件流
    for (const [key, stream] of this.fileStreams.entries()) {
      stream.end();
    }
    this.fileStreams.clear();
    this.streamDates.clear();
    this.buffer = [];
  }
}

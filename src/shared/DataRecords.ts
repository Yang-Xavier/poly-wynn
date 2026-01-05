import * as fs from "fs";
import * as path from "path";

export interface DataRecordsConfig {
  appName: string; // 应用名称，必填
  dataDir?: string; // 数据目录，默认为 './data'
}

// 默认配置
const DEFAULT_CONFIG: Required<Omit<DataRecordsConfig, "appName">> = {
  dataDir: "./data",
};

/**
 * 数据记录器 - 用于记录数据到 JSON 文件
 *
 * 特性：
 * - 支持按 appName、date_traceId_data.json 组织文件结构
 * - 文件路径：data/appName/date_traceId_data.json
 * - 数据存储在内存中，格式为 {dataName: [data1, data2, ...]}
 * - 调用 saveToJson 方法时一次性写入 JSON 文件
 * - 日期在 setTraceId 时按北京时间（UTC+8）计算并保存，后续保存文件时使用该日期
 * - 支持清理旧数据
 */
export class DataRecords {
  private config: Required<DataRecordsConfig>;
  private traceId: string = "";
  // 存储数据：traceId -> {dataName: [data1, data2, ...]}
  private dataStorage: Map<string, Record<string, any[]>> = new Map();
  // 存储每个 traceId 对应的日期文件夹名称：traceId -> dateFolder
  private traceIdDateMap: Map<string, string> = new Map();

  constructor(config: DataRecordsConfig) {
    if (!config.appName) {
      throw new Error("appName 是必填参数");
    }
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 确保数据目录存在
    if (!fs.existsSync(this.config.dataDir)) {
      fs.mkdirSync(this.config.dataDir, { recursive: true });
    }
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
   * 目录结构：data/appName/date_traceId_data.json
   */
  private getDataFilePath(dateFolder: string, traceId: string): string {
    // appName 目录
    const appNameDir = path.join(this.config.dataDir, this.config.appName);
    // 确保 appName 目录存在
    if (!fs.existsSync(appNameDir)) {
      fs.mkdirSync(appNameDir, { recursive: true });
    }
    // 文件名：date_traceId_data.json
    const fileName = `${dateFolder}_${traceId}_data.json`;
    return path.join(appNameDir, fileName);
  }

  /**
   * 设置 traceId
   * 在设置时会计算并保存当前日期，后续保存文件时使用该日期
   */
  setTraceId(traceId: string): void {
    this.traceId = traceId;
    // 如果该 traceId 还没有数据存储，初始化它
    if (!this.dataStorage.has(traceId)) {
      this.dataStorage.set(traceId, {});
    }
    // 计算并保存当前日期（如果该 traceId 还没有日期，则设置）
    if (!this.traceIdDateMap.has(traceId)) {
      const dateFolder = this.getDateFolderName();
      this.traceIdDateMap.set(traceId, dateFolder);
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

    // 获取或创建当前 traceId 的数据存储
    if (!this.dataStorage.has(this.traceId)) {
      this.dataStorage.set(this.traceId, {});
    }
    const traceData = this.dataStorage.get(this.traceId)!;

    // 如果该 dataName 不存在，初始化数组
    if (!traceData[dataName]) {
      traceData[dataName] = [];
    }

    // 将数据添加到对应 dataName 的数组中
    traceData[dataName].push(data);
  }

  /**
   * 将指定 traceId 的数据保存到 JSON 文件
   * @param traceId 要保存的 traceId，如果不提供则使用当前 traceId
   * @returns 返回保存的文件路径，如果数据为空则返回 null
   */
  saveToJson(traceId?: string): string | null {
    const targetTraceId = traceId || this.traceId;
    if (!targetTraceId) {
      throw new Error("请提供 traceId 或先调用 setTraceId 设置 traceId");
    }

    // 获取该 traceId 的数据
    const traceData = this.dataStorage.get(targetTraceId);
    if (!traceData || Object.keys(traceData).length === 0) {
      return null; // 没有数据，不创建文件
    }

    // 获取该 traceId 对应的日期（在 setTraceId 时已计算）
    const dateFolder = this.traceIdDateMap.get(targetTraceId);
    if (!dateFolder) {
      throw new Error(`traceId ${targetTraceId} 没有对应的日期，请先调用 setTraceId 设置 traceId`);
    }

    // 获取文件路径
    const filePath = this.getDataFilePath(dateFolder, targetTraceId);

    try {
      // 将数据对象序列化为 JSON（格式化输出，使用 2 个空格缩进）
      const jsonContent = JSON.stringify(traceData);

      // 同步写入文件
      fs.writeFileSync(filePath, jsonContent, "utf8");

      return filePath;
    } catch (error) {
      throw new Error(
        `保存 JSON 文件失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 清理指定天数之前的数据
   * @param days 保留最近N天的数据，N天之前的数据将被删除
   * @returns 返回被删除的文件数量
   */
  cleanOldData(days: number): number {
    if (days < 0) {
      throw new Error("days参数必须大于等于0");
    }

    // 如果数据目录不存在，直接返回
    if (!fs.existsSync(this.config.dataDir)) {
      return 0;
    }

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

      // 读取 appName 目录下的所有文件
      const files = fs.readdirSync(appNamePath);

      for (const fileName of files) {
        // 检查文件名是否符合格式：date_traceId_data.json
        // 匹配格式：YYYY-MM-DD_traceId_data.json
        const fileMatch = fileName.match(/^(\d{4})-(\d{2})-(\d{2})_(.+)_data\.json$/);
        if (!fileMatch) {
          // 如果文件名不符合格式，跳过
          continue;
        }

        const dateStr = `${fileMatch[1]}-${fileMatch[2]}-${fileMatch[3]}`;

        // 如果是当前日期的文件，跳过
        if (dateStr === currentDateFolder) {
          continue;
        }

        // 解析日期（按北京时区解析）
        const year = parseInt(fileMatch[1], 10);
        const month = parseInt(fileMatch[2], 10) - 1; // 月份从0开始
        const day = parseInt(fileMatch[3], 10);

        // 创建北京时区当天的0点（使用UTC时间表示）
        const fileDate = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
        // 转换为UTC时间戳（减去8小时偏移，使其对应北京时区的0点）
        const fileDateUTC = fileDate.getTime() - 8 * 60 * 60 * 1000;

        // 如果文件日期早于截止时间，删除该文件
        if (fileDateUTC < cutoffTime) {
          const filePath = path.join(appNamePath, fileName);

          try {
            // 删除文件
            fs.unlinkSync(filePath);
            deletedCount++;
            console.log(`已删除旧数据文件: ${this.config.appName}/${fileName}`);
          } catch (error) {
            console.error(`删除数据文件失败: ${this.config.appName}/${fileName}`, error);
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
   * 清理资源
   */
  close(): void {
    // 清空数据存储
    this.dataStorage.clear();
    // 清空日期映射
    this.traceIdDateMap.clear();
    this.traceId = "";
  }
}

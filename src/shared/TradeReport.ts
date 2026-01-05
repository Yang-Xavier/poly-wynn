import * as fs from "fs";
import * as path from "path";

type TradeReportType = "trade" | "result" | "balance";
type Trade = {
  action: "buy" | "sell";
  timestamp: number;
  price: number;
  amount: number;
  outcome: string;
};

type Result = {
  result: "won" | "lost" | "hold" | "sold" | "skipped" | "waiting...";
};

type Balance = {
  balance: number;
};

type ReportData = {
  timestamp: number;
  traceId: string;
  result?: string;
  trades?: Trade[];
  balance?: number;
  profit?: number;
};

type ReportFile = {
  reports: ReportData[];
};

export default class TradeReport {
  private traceId: string;
  private appName: string;
  private reportDir: string = "./report";
  private dateReport: ReportFile | null = null;
  private loadedDate: string | null = null;
  // 存储每个 traceId 对应的日期文件夹名称：traceId -> dateFolder
  private traceIdDateMap: Map<string, string> = new Map();

  protected traceReport: ReportData | null = null;

  constructor(appName: string) {
    this.appName = appName;
  }

  setTraceId(traceId: string) {
    this.traceId = traceId;
    // 计算并保存当前日期（如果该 traceId 还没有日期，则设置）
    if (!this.traceIdDateMap.has(traceId)) {
      const dateFolder = this.getDateFolderName();
      this.traceIdDateMap.set(traceId, dateFolder);
    }
    // 加载当日报告，以便在 addReport 时可以查找或创建对应的 report
    this.loadDateReport();
    // 查找是否已存在相同 traceId 的 report
    if (this.dateReport) {
      const existingReport = this.dateReport.reports.find((report) => report.traceId === traceId);
      if (existingReport) {
        this.traceReport = existingReport;
      } else {
        this.traceReport = {
          timestamp: Date.now(),
          traceId: traceId,
          trades: [],
          result: "waiting...",
          balance: 0,
          profit: 0,
        };
        this.dateReport.reports.push(this.traceReport);
        this.saveDateReport();
      }
    }
  }

  addReport<T extends TradeReportType>(
    type: T,
    data: T extends "trade" ? Trade : T extends "result" ? Result : Balance
  ) {
    if (!this.traceId) {
      throw new Error("请先调用 setTraceId 设置 traceId");
    }

    // 根据 type 更新 traceReport
    switch (type) {
      case "trade":
        const trade = data as Trade;
        if (!this.traceReport.trades) {
          this.traceReport.trades = [];
        }
        if (!this.traceReport.trades.find((t) => t.timestamp === trade.timestamp)) {
          this.traceReport.trades.push(trade);
        }
        break;
      case "result":
        this.traceReport.result = (data as Result).result;
        break;
      case "balance":
        this.traceReport.balance = (data as Balance).balance;
        break;
    }

    // 更新 timestamp
    this.traceReport.timestamp = Date.now();

    // 计算 profit
    this.traceReport.profit = this.calcProfit();

    // 保存到文件
    this.saveDateReport();
  }

  protected calcProfit() {
    let profit = 0;
    if (this.traceReport.trades && this.traceReport.trades.length > 0) {
      this.traceReport.trades.forEach((trade) => {
        if (trade.action === "sell") {
          profit += trade.amount * trade.price;
        } else if (trade.action === "buy") {
          profit -= trade.amount * trade.price;
        }
      });
    }
    return profit;
  }

  protected loadDateReport() {
    if (!this.traceId) {
      throw new Error("请先调用 setTraceId 设置 traceId");
    }

    // 获取该 traceId 对应的日期（在 setTraceId 时已计算）
    const currentDate = this.traceIdDateMap.get(this.traceId);
    if (!currentDate) {
      throw new Error(`traceId ${this.traceId} 没有对应的日期，请先调用 setTraceId 设置 traceId`);
    }

    // 如果已经加载过当日的报告，直接返回
    if (this.dateReport && this.loadedDate === currentDate) {
      return;
    }

    // 获取报告文件路径
    const filePath = this.getReportFilePath();

    // 如果文件不存在，初始化为空报告
    if (!fs.existsSync(filePath)) {
      this.dateReport = { reports: [] };
      this.loadedDate = currentDate;
      return;
    }

    // 读取并解析报告文件
    try {
      const fileContent = fs.readFileSync(filePath, "utf-8");
      this.dateReport = JSON.parse(fileContent);
      // 确保 reports 是数组
      if (!Array.isArray(this.dateReport.reports)) {
        this.dateReport.reports = [];
      }
      this.loadedDate = currentDate;
    } catch (error) {
      console.error(`加载报告文件失败: ${filePath}`, error);
      // 如果读取失败，使用空数据
      this.dateReport = { reports: [] };
      this.loadedDate = currentDate;
    }
  }

  private saveDateReport() {
    if (!this.dateReport) {
      return;
    }

    const filePath = this.getReportFilePath();

    try {
      fs.writeFileSync(filePath, JSON.stringify(this.dateReport, null, 2), "utf-8");
    } catch (error) {
      console.error(`保存报告文件失败: ${filePath}`, error);
      throw error;
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
   * 获取报告文件的完整路径
   * 目录结构：report/appName/date_report.json
   */
  private getReportFilePath(): string {
    if (!this.traceId) {
      throw new Error("请先调用 setTraceId 设置 traceId");
    }

    // 获取该 traceId 对应的日期（在 setTraceId 时已计算）
    const dateFolder = this.traceIdDateMap.get(this.traceId);
    if (!dateFolder) {
      throw new Error(`traceId ${this.traceId} 没有对应的日期，请先调用 setTraceId 设置 traceId`);
    }

    // appName 目录
    const appNameDir = path.join(this.reportDir, this.appName);
    // 确保 appName 目录存在
    if (!fs.existsSync(appNameDir)) {
      fs.mkdirSync(appNameDir, { recursive: true });
    }
    // 文件名：date_report.json
    const fileName = `${dateFolder}_report.json`;
    return path.join(appNameDir, fileName);
  }

  /**
   * 清理 x 天之前的报告文件
   * @param days 保留最近几天的报告，超过这个天数的报告将被删除
   * @returns 返回删除的文件数量
   */
  cleanOldReports(days: number): number {
    const appNameDir = path.join(this.reportDir, this.appName);

    // 如果目录不存在，直接返回
    if (!fs.existsSync(appNameDir)) {
      return 0;
    }

    // 获取当前日期（北京时区）
    const now = new Date();
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const today = new Date(
      beijingTime.getUTCFullYear(),
      beijingTime.getUTCMonth(),
      beijingTime.getUTCDate()
    );

    let deletedCount = 0;

    try {
      // 读取目录下的所有文件
      const files = fs.readdirSync(appNameDir);

      for (const file of files) {
        // 只处理符合格式的文件：YYYY-MM-DD_report.json
        const match = file.match(/^(\d{4}-\d{2}-\d{2})_report\.json$/);
        if (!match) {
          continue;
        }

        const dateStr = match[1];
        const [year, month, day] = dateStr.split("-").map(Number);

        // 创建文件日期（北京时区）
        const fileDate = new Date(year, month - 1, day);

        // 计算日期差（天数）
        const diffTime = today.getTime() - fileDate.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        // 如果超过指定天数，删除文件
        if (diffDays > days) {
          const filePath = path.join(appNameDir, file);
          try {
            fs.unlinkSync(filePath);
            deletedCount++;
            console.log(`已删除旧报告文件: ${filePath}`);
          } catch (error) {
            console.error(`删除报告文件失败: ${filePath}`, error);
          }
        }
      }
    } catch (error) {
      console.error(`清理旧报告时出错: ${appNameDir}`, error);
    }

    return deletedCount;
  }
}

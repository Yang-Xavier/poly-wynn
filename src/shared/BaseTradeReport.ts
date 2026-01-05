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

export default class BaseTradeReport {
  private trades: Trade[];
  private result: string = "waiting...";
  private balance: number;
  private traceId: string;
  private appName: string;
  private reportDir: string = "./report";

  constructor(appName: string) {
    this.appName = appName;
  }

  setTraceId(traceId: string) {
    this.reset();
    this.traceId = traceId;
    this.updateReport();
  }

  addReport<T extends TradeReportType>(
    type: T,
    data: T extends "trade" ? Trade : T extends "result" ? Result : Balance
  ) {
    switch (type) {
      case "trade":
        this.trades.push(data as Trade);
        break;
      case "result":
        this.result = (data as Result).result;
        break;
      case "balance":
        this.balance = (data as Balance).balance;
        break;
    }
    this.updateReport();
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
    const dateFolder = this.getDateFolderName();
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

  private getProfit() {
    let profit = 0;
    this.trades.forEach((trade) => {
      if (trade.action === "sell") {
        profit += trade.amount * trade.price;
      } else if (trade.action === "buy") {
        profit -= trade.amount * trade.price;
      }
    });
    return profit;
  }

  private updateReport() {
    if (!this.traceId) {
      throw new Error("请先调用 setTraceId 设置 traceId");
    }

    const filePath = this.getReportFilePath();
    const timestamp = Date.now();

    // 构建当前报告数据
    const currentReport: ReportData = {
      timestamp,
      traceId: this.traceId,
      profit: this.getProfit(),
    };

    // 添加 result（如果有）
    if (this.result) {
      currentReport.result = this.result;
    }

    // 添加 trades（如果有）
    if (this.trades && this.trades.length > 0) {
      currentReport.trades = [...this.trades];
    }

    // 添加 balance（如果有且不为0）
    if (this.balance !== undefined && this.balance !== null && this.balance !== 0) {
      currentReport.balance = this.balance;
    }

    // 读取现有文件（如果存在）
    let reportFile: ReportFile = { reports: [] };
    if (fs.existsSync(filePath)) {
      try {
        const fileContent = fs.readFileSync(filePath, "utf-8");
        reportFile = JSON.parse(fileContent);
        // 确保 reports 是数组
        if (!Array.isArray(reportFile.reports)) {
          reportFile.reports = [];
        }
      } catch (error) {
        console.error(`读取报告文件失败: ${filePath}`, error);
        // 如果读取失败，使用空数据
        reportFile = { reports: [] };
      }
    }

    // 查找是否已存在相同 traceId 的报告
    const existingIndex = reportFile.reports.findIndex((report) => report.traceId === this.traceId);

    if (existingIndex !== -1) {
      // 如果存在，进行 merge 操作
      const existingReport = reportFile.reports[existingIndex];

      // merge result（如果当前有值，则更新）
      if (currentReport.result) {
        existingReport.result = currentReport.result;
      }

      // merge trades（append 操作）
      if (currentReport.trades && currentReport.trades.length > 0) {
        if (!existingReport.trades) {
          existingReport.trades = [];
        }
        existingReport.trades.push(...currentReport.trades);
      }

      // merge balance（如果当前有值，则更新）
      if (currentReport.balance !== undefined && currentReport.balance !== null) {
        existingReport.balance = currentReport.balance;
      }

      // 更新 timestamp
      existingReport.timestamp = timestamp;
    } else {
      // 如果不存在，添加新报告
      reportFile.reports.push(currentReport);
    }

    // 写入文件
    try {
      fs.writeFileSync(filePath, JSON.stringify(reportFile, null, 2), "utf-8");
    } catch (error) {
      console.error(`写入报告文件失败: ${filePath}`, error);
      throw error;
    }
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

  private reset() {
    this.trades = [];
    this.result = "waiting...";
    this.balance = 0;
    this.traceId = "";
  }
}

import * as path from "path";
import * as fs from "fs";
import { ParsedLog, LogFileType } from "../types";
import { extractDateFromLogTimestamp } from "./dateUtils";

/**
 * 日志解析工具
 */

/**
 * 获取项目根目录（logs 目录所在位置）
 * 从当前文件位置向上查找，直到找到包含 logs 目录的目录
 */
function getProjectRoot(): string {
  // 从当前文件位置开始
  let currentDir = __dirname;
  const rootDir = path.parse(currentDir).root; // 获取根目录（Windows: C:\, Unix: /）
  
  // 向上查找，直到找到包含 logs 目录的目录
  while (currentDir !== rootDir) {
    const logsPath = path.join(currentDir, "logs");
    if (fs.existsSync(logsPath)) {
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break; // 已经到达根目录
    }
    currentDir = parentDir;
  }
  
  // 如果找不到，尝试从工作目录查找（process.cwd()）
  const cwd = process.cwd();
  const cwdLogsPath = path.join(cwd, "logs");
  if (fs.existsSync(cwdLogsPath)) {
    return cwd;
  }
  
  // 如果还是找不到，使用相对路径（从项目根目录运行的情况）
  // 尝试从 dist 目录向上查找
  if (__dirname.includes("dist")) {
    // 如果在 dist 目录中，向上两级到项目根目录
    return path.resolve(__dirname, "../..");
  }
  
  // 默认返回当前目录的上级（假设在 src/app/server 中）
  return path.resolve(__dirname, "../../../..");
}

/**
 * 解析单行日志，提取 date 和 traceId
 * 日志格式: [2025-12-30 10:57:04.519 北京时间]  [Type: trade] [INFO]  [TraceID: eth-updown-15m-1767062700] => ...
 */
export function parseLogLine(line: string): ParsedLog | null {
  // 提取时间戳部分
  const timestampMatch = line.match(/^\[([^\]]+)\]/);
  if (!timestampMatch) {
    return null;
  }

  const timestamp = timestampMatch[1];
  const date = extractDateFromLogTimestamp(timestamp);
  if (!date) {
    return null;
  }

  // 提取 TraceID
  const traceIdMatch = line.match(/\[TraceID:\s*([^\]]+)\]/);
  const traceId = traceIdMatch ? traceIdMatch[1] : "";

  return {
    date,
    traceId,
    rawLine: line.trim(),
    timestamp,
  };
}

/**
 * 读取日志文件并解析所有行
 */
export function parseLogFile(filePath: string): ParsedLog[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());

  const parsedLogs: ParsedLog[] = [];
  for (const line of lines) {
    const parsed = parseLogLine(line);
    if (parsed) {
      parsedLogs.push(parsed);
    }
  }

  return parsedLogs;
}

/**
 * 获取日志文件路径
 */
export function getLogFilePath(
  date: string,
  logType: LogFileType,
  baseDir?: string
): string {
  const projectRoot = baseDir || getProjectRoot();
  const logsDir = path.join(projectRoot, "logs");
  
  const fileName =
    logType === "default"
      ? "crypto15min.log"
      : logType === "trade"
        ? "crypto15min_trade.log"
        : "crypto15min_data.log";

  return path.join(logsDir, date, fileName);
}


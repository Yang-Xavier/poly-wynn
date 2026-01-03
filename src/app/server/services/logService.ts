import * as path from "path";
import * as fs from "fs";
import { ParsedLog, LogChunk, TraceIdSummary } from "../types";
import {
  parseLogFile,
  getLogFilePath,
  getTraceIdDirs,
  getLogFilesInDir,
} from "../utils/logParser";
import { getTodayDateString, isValidDateString } from "../utils/dateUtils";

/**
 * 获取项目根目录
 */
function getProjectRoot(): string {
  let currentDir = __dirname;
  const rootDir = path.parse(currentDir).root;
  
  while (currentDir !== rootDir) {
    const logsPath = path.join(currentDir, "logs");
    if (fs.existsSync(logsPath)) {
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }
  
  const cwd = process.cwd();
  const cwdLogsPath = path.join(cwd, "logs");
  if (fs.existsSync(cwdLogsPath)) {
    return cwd;
  }
  
  if (__dirname.includes("dist")) {
    return path.resolve(__dirname, "../..");
  }
  
  return path.resolve(__dirname, "../../../..");
}

/**
 * 日志服务层
 */

/**
 * 获取指定 appName 和 date 的所有 traceId 的 trade 日志（聚合）
 */
export function getTradeLogs(appName: string, date?: string): ParsedLog[] {
  const targetDate = date && isValidDateString(date) ? date : getTodayDateString();
  const traceIdDirs = getTraceIdDirs(appName, targetDate);
  
  const allLogs: ParsedLog[] = [];
  
  // 遍历所有 traceId 目录，读取 trade.log
  for (const traceId of traceIdDirs) {
    const tradeLogPath = getLogFilePath(appName, targetDate, traceId, "trade");
    const logs = parseLogFile(tradeLogPath);
    allLogs.push(...logs);
  }
  
  // 按时间戳排序
  allLogs.sort((a, b) => {
    if (a.timestamp && b.timestamp) {
      return a.timestamp.localeCompare(b.timestamp);
    }
    return 0;
  });
  
  return allLogs;
}

/**
 * 获取指定 appName 和 date 的所有 traceId 的汇总信息（按 traceId 分组）
 */
export function getChanceLogs(appName: string, date?: string): TraceIdSummary[] {
  const targetDate = date && isValidDateString(date) ? date : getTodayDateString();
  const traceIdDirs = getTraceIdDirs(appName, targetDate);
  
  const summaries: TraceIdSummary[] = [];
  
  // 遍历所有 traceId 目录，读取 Chance.log
  for (const traceId of traceIdDirs) {
    const chanceLogPath = getLogFilePath(appName, targetDate, traceId, "Chance");
    const logs = parseLogFile(chanceLogPath);
    
    if (logs.length > 0) {
      // 按时间戳排序
      logs.sort((a, b) => {
        if (a.timestamp && b.timestamp) {
          return a.timestamp.localeCompare(b.timestamp);
        }
        return 0;
      });
      
      summaries.push({
        traceId,
        date: targetDate,
        logCount: logs.length,
        latestLog: logs[logs.length - 1], // 最新的日志
        firstLog: logs[0], // 最早的日志
      });
    }
  }
  
  // 按 traceId 排序
  summaries.sort((a, b) => a.traceId.localeCompare(b.traceId));
  
  return summaries;
}

/**
 * 根据 appName, date, traceId 获取所有类型的日志文件
 */
export function getLogsByTraceId(
  appName: string,
  date: string,
  traceId: string
): LogChunk[] {
  if (!isValidDateString(date)) {
    return [];
  }

  const projectRoot = getProjectRoot();
  const traceIdDir = path.join(projectRoot, "logs", appName, date, traceId);
  
  const logFiles = getLogFilesInDir(traceIdDir);
  const chunks: LogChunk[] = [];

  for (const logFile of logFiles) {
    const logs = parseLogFile(logFile.path);
    if (logs.length > 0) {
      chunks.push({
        type: logFile.name,
        logs: logs,
      });
    }
  }

  return chunks;
}

/**
 * 解析 trade 日志的 type 和 data
 */
interface TradeLogData {
  outcome?: string;
  size_matched?: number | string;
  avgPrice?: number;
  price?: number | string;
  original_size?: number | string;
}

/**
 * 格式化数字，保留2位小数
 */
function formatNumber(value: number | string | undefined | null): string {
  if (value === undefined || value === null || value === "N/A") {
    return "N/A";
  }
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) {
    return "N/A";
  }
  return num.toFixed(2);
}

function parseTradeLogTypeAndData(rawLine: string): {
  type: string;
  emoji: string;
  data: TradeLogData | null;
  message: string;
} {
  // 提取 emoji 和 type，例如：✅ buy, ❌ sell, 💰 balance
  const emojiTypeMatch = rawLine.match(/=>\s*([^\s]+)\s+(\w+)/);
  const emoji = emojiTypeMatch ? emojiTypeMatch[1] : "";
  const type = emojiTypeMatch ? emojiTypeMatch[2] : "";

  // 提取 Data 部分的 JSON
  const dataMatch = rawLine.match(/\|\s*Data:\s*(\{.*\})/);
  let data: TradeLogData | null = null;

  if (dataMatch) {
    try {
      data = JSON.parse(dataMatch[1]);
    } catch (e) {
      // JSON 解析失败，忽略
      data = null;
    }
  }

  // 提取 message 部分（在 => 之后，| Data 之前）
  const messageMatch = rawLine.match(/=>\s*[^\s]+\s+\w+\s+(.*?)(?:\s*\|\s*Data:|$)/);
  const message = messageMatch ? messageMatch[1].trim() : "";

  return { type, emoji, data, message };
}

/**
 * 格式化 trade 日志显示
 */
function formatTradeLog(rawLine: string): string {
  const { type, emoji, data, message } = parseTradeLogTypeAndData(rawLine);

  // 提取时间戳和基础信息
  const timestampMatch = rawLine.match(/^\[([^\]]+)\]/);
  const timestamp = timestampMatch ? timestampMatch[1] : "";

  // 对于 buy 和 sell，解析并格式化 data
  if ((type === "buy" || type === "sell") && data) {
    const outcome = data.outcome || "N/A";
    const sizeMatched = formatNumber(data.size_matched);
    const avgPrice = formatNumber(data.avgPrice ?? data.price);
    const originalSize = formatNumber(data.original_size);
    const price = formatNumber(data.price);

    const formattedData = `outcome:${outcome}, matched: ${sizeMatched}@${avgPrice}, original: ${originalSize}@${price}`;
    return `[${timestamp}] ${emoji} ${type} ${formattedData}`;
  }

  // 其他 type，不显示 data，只显示基础信息
  if (message && message !== "undefined") {
    return `[${timestamp}] ${emoji} ${type} ${message}`;
  }

  return `[${timestamp}] ${emoji} ${type}`;
}

/**
 * 格式化 trade 日志（不添加链接，链接在控制器中添加）
 */
export function formatTradeLogForDisplay(log: ParsedLog): string {
  return formatTradeLog(log.rawLine);
}


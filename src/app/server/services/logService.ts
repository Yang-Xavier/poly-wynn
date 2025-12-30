import * as path from "path";
import { ParsedLog, LogFileType, LogChunk } from "../types";
import { parseLogFile, getLogFilePath } from "../utils/logParser";
import { getTodayDateString, isValidDateString } from "../utils/dateUtils";

/**
 * 日志服务层
 */

/**
 * 获取指定日期的 trade 日志
 */
export function getTradeLogs(date?: string): ParsedLog[] {
  const targetDate = date && isValidDateString(date) ? date : getTodayDateString();
  const filePath = getLogFilePath(targetDate, "trade");
  const logs = parseLogFile(filePath);
  return logs;
}

/**
 * 根据 traceId 筛选指定日期的日志
 * 从 data 和 default 日志文件中筛选
 */
export function getLogsByTraceId(date: string, traceId: string): LogChunk[] {
  if (!isValidDateString(date)) {
    return [];
  }

  const chunks: LogChunk[] = [];

  // 读取 data 日志
  const dataFilePath = getLogFilePath(date, "data");
  const dataLogs = parseLogFile(dataFilePath);
  const filteredDataLogs = dataLogs.filter((log) => log.traceId === traceId);
  if (filteredDataLogs.length > 0) {
    chunks.push({
      type: "data",
      logs: filteredDataLogs,
    });
  }

  // 读取 default 日志
  const defaultFilePath = getLogFilePath(date, "default");
  const defaultLogs = parseLogFile(defaultFilePath);
  const filteredDefaultLogs = defaultLogs.filter((log) => log.traceId === traceId);
  if (filteredDefaultLogs.length > 0) {
    chunks.push({
      type: "default",
      logs: filteredDefaultLogs,
    });
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
 * 为 trade 日志添加链接
 */
export function addLinkToTradeLog(log: ParsedLog, baseUrl: string = ""): string {
  const link = `${baseUrl}/log?date=${log.date}&traceId=${encodeURIComponent(log.traceId)}`;
  const formattedLog = formatTradeLog(log.rawLine);
  return `${formattedLog} <a href="${link}">查看详情</a>`;
}


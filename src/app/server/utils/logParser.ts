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
 * 获取日志文件路径（新结构：/logs/{appName}/{date}/{traceId}/{type}.log）
 */
export function getLogFilePath(
  appName: string,
  date: string,
  traceId: string,
  logType: string,
  baseDir?: string
): string {
  const projectRoot = baseDir || getProjectRoot();
  const logsDir = path.join(projectRoot, "logs");
  const fileName = `${logType}.log`;
  return path.join(logsDir, appName, date, traceId, fileName);
}

/**
 * 获取指定 appName 和 date 下所有 traceId 目录
 */
export function getTraceIdDirs(appName: string, date: string, baseDir?: string): string[] {
  const projectRoot = baseDir || getProjectRoot();
  const dateDir = path.join(projectRoot, "logs", appName, date);
  
  if (!fs.existsSync(dateDir)) {
    return [];
  }

  const entries = fs.readdirSync(dateDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(); // 按字母顺序排序
}

/**
 * 获取指定目录下的所有 log 文件
 */
export function getLogFilesInDir(dirPath: string): Array<{ name: string; path: string }> {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
    .map((entry) => ({
      name: entry.name.replace(".log", ""),
      path: path.join(dirPath, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}


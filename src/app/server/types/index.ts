// 日志解析结果
export interface ParsedLog {
  date: string; // yyyy-mm-dd
  traceId: string;
  rawLine: string; // 原始日志行
  timestamp?: string; // 完整时间戳
}

// 日志文件类型
export type LogFileType = "trade" | "data" | "default";

// 日志查询参数
export interface TradeQueryParams {
  date?: string; // yyyy-mm-dd
}

export interface LogQueryParams {
  date: string; // yyyy-mm-dd
  traceId: string;
}

// 日志块（用于分块返回）
export interface LogChunk {
  type: LogFileType;
  logs: ParsedLog[];
}


// 日志解析结果
export interface ParsedLog {
  date: string; // yyyy-mm-dd
  traceId: string;
  rawLine: string; // 原始日志行
  timestamp?: string; // 完整时间戳
}

// 日志查询参数
export interface TradeQueryParams {
  date?: string; // yyyy-mm-dd
}

export interface LogQueryParams {
  date: string; // yyyy-mm-dd
  traceId: string;
  appName?: string; // 应用名称
}

// 日志块（用于分块返回）
export interface LogChunk {
  type: string; // 日志文件类型（如 trade, app, BnPriceWs 等）
  logs: ParsedLog[];
}


import { Request, Response } from "express";
import { getLogsByTraceId } from "../services/logService";
import { LogQueryParams } from "../types";
import { isValidDateString } from "../utils/dateUtils";

/**
 * Log 控制器
 */

/**
 * 根据 traceId 获取日志
 * GET /log?date=yyyy-mm-dd&traceId=xxxx
 */
export async function getLogsByTraceIdHandler(
  req: Request<{}, any, any, LogQueryParams>,
  res: Response
): Promise<void> {
  try {
    const { date, traceId } = req.query;

    // 参数验证
    if (!date || !traceId) {
      res.status(400).json({ error: "缺少必要参数: date 和 traceId" });
      return;
    }

    if (!isValidDateString(date)) {
      res.status(400).json({ error: "日期格式错误，应为 yyyy-mm-dd" });
      return;
    }

    const chunks = getLogsByTraceId(date, traceId);

    if (chunks.length === 0) {
      res.status(404).json({ error: "未找到匹配的日志" });
      return;
    }

    // 分离 data 和 default 日志
    const dataChunk = chunks.find((chunk) => chunk.type === "data");
    const defaultChunk = chunks.find((chunk) => chunk.type === "default");
    const dataLogs = dataChunk ? dataChunk.logs : [];
    const defaultLogs = defaultChunk ? defaultChunk.logs : [];

    // 返回 HTML 格式，左右并排展示
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>日志详情 - ${traceId}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .header {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      padding: 20px 30px;
      border-radius: 12px;
      margin-bottom: 20px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }
    h1 {
      color: #333;
      font-size: 24px;
      margin-bottom: 10px;
    }
    .meta {
      color: #666;
      font-size: 14px;
    }
    .meta strong {
      color: #667eea;
      font-weight: 600;
    }
    .logs-container {
      display: flex;
      gap: 20px;
      height: calc(100vh - 180px);
    }
    .log-panel {
      flex: 1;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }
    .log-panel-header {
      padding: 15px 20px;
      font-weight: 600;
      font-size: 16px;
      color: white;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .log-panel-header.data {
      background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
    }
    .log-panel-header.default {
      background: linear-gradient(135deg, #FF9800 0%, #f57c00 100%);
    }
    .log-count {
      background: rgba(255, 255, 255, 0.2);
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
    }
    .log-content {
      flex: 1;
      overflow-y: auto;
      padding: 15px;
      background: #fafafa;
    }
    .log-content::-webkit-scrollbar {
      width: 8px;
    }
    .log-content::-webkit-scrollbar-track {
      background: #f1f1f1;
      border-radius: 4px;
    }
    .log-content::-webkit-scrollbar-thumb {
      background: #888;
      border-radius: 4px;
    }
    .log-content::-webkit-scrollbar-thumb:hover {
      background: #555;
    }
    .log-line {
      margin: 6px 0;
      padding: 10px 12px;
      background: white;
      border-left: 4px solid #667eea;
      border-radius: 4px;
      word-wrap: break-word;
      white-space: pre-wrap;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.6;
      color: #333;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
      transition: all 0.2s ease;
    }
    .log-line:hover {
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
      transform: translateX(2px);
    }
    .empty-panel {
      display: flex;
      align-items: center;
      justify-content: center;
      color: #999;
      font-size: 14px;
      height: 100%;
    }
    @media (max-width: 768px) {
      .logs-container {
        flex-direction: column;
        height: auto;
      }
      .log-panel {
        min-height: 400px;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>📋 日志详情</h1>
    <div class="meta">
      <strong>日期:</strong> ${date} | <strong>TraceID:</strong> ${traceId} | 
      <strong>总计:</strong> ${dataLogs.length + defaultLogs.length} 条日志
    </div>
  </div>
  <div class="logs-container">
    <div class="log-panel">
      <div class="log-panel-header data">
        <span>📊 Data 日志</span>
        <span class="log-count">${dataLogs.length} 条</span>
      </div>
      <div class="log-content">
        ${
          dataLogs.length > 0
            ? dataLogs.map((log) => `<div class="log-line">${log.rawLine}</div>`).join("")
            : '<div class="empty-panel">暂无 Data 日志</div>'
        }
      </div>
    </div>
    <div class="log-panel">
      <div class="log-panel-header default">
        <span>📝 默认日志</span>
        <span class="log-count">${defaultLogs.length} 条</span>
      </div>
      <div class="log-content">
        ${
          defaultLogs.length > 0
            ? defaultLogs.map((log) => `<div class="log-line">${log.rawLine}</div>`).join("")
            : '<div class="empty-panel">暂无默认日志</div>'
        }
      </div>
    </div>
  </div>
</body>
</html>
    `;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error) {
    console.error("获取日志失败:", error);
    res.status(500).json({ error: "获取日志失败" });
  }
}


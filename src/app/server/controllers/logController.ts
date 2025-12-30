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

    // 返回 HTML 格式，分块展示
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>日志详情 - ${traceId}</title>
  <style>
    body {
      font-family: 'Courier New', monospace;
      margin: 20px;
      background-color: #f5f5f5;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      color: #333;
      border-bottom: 2px solid #2196F3;
      padding-bottom: 10px;
    }
    .chunk {
      margin: 30px 0;
      border: 1px solid #ddd;
      border-radius: 4px;
      overflow: hidden;
    }
    .chunk-header {
      background: #2196F3;
      color: white;
      padding: 10px 15px;
      font-weight: bold;
      font-size: 1.1em;
    }
    .chunk-header.data {
      background: #4CAF50;
    }
    .chunk-header.default {
      background: #FF9800;
    }
    .chunk-content {
      padding: 15px;
      background: #fafafa;
    }
    .log-line {
      margin: 8px 0;
      padding: 8px;
      background: white;
      border-left: 3px solid #2196F3;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
    .meta {
      color: #666;
      margin-bottom: 20px;
      padding: 10px;
      background: #e3f2fd;
      border-radius: 4px;
    }
    .count {
      color: #999;
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>日志详情</h1>
    <div class="meta">
      <strong>日期:</strong> ${date} | <strong>TraceID:</strong> ${traceId}
    </div>
    ${chunks
      .map(
        (chunk) => `
      <div class="chunk">
        <div class="chunk-header ${chunk.type}">
          ${chunk.type === "data" ? "📊 Data 日志" : "📝 默认日志"} (${chunk.logs.length} 条)
        </div>
        <div class="chunk-content">
          ${chunk.logs
            .map((log) => `<div class="log-line">${log.rawLine}</div>`)
            .join("")}
        </div>
      </div>
    `
      )
      .join("")}
    <div class="count">总计: ${chunks.reduce((sum, chunk) => sum + chunk.logs.length, 0)} 条日志</div>
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


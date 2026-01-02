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
    const { date, traceId, appName } = req.query;

    // 参数验证
    if (!date || !traceId) {
      res.status(400).json({ error: "缺少必要参数: date 和 traceId" });
      return;
    }

    if (!isValidDateString(date)) {
      res.status(400).json({ error: "日期格式错误，应为 yyyy-mm-dd" });
      return;
    }

    const targetAppName = appName || "crypto15min"; // 默认使用 crypto15min
    const chunks = getLogsByTraceId(targetAppName, date, traceId);

    if (chunks.length === 0) {
      res.status(404).json({ error: "未找到匹配的日志" });
      return;
    }

    const totalLogs = chunks.reduce((sum, chunk) => sum + chunk.logs.length, 0);

    // 生成日志块 HTML（带折叠功能）
    const logChunksHtml = chunks
      .map(
        (chunk, index) => `
      <div class="log-chunk">
        <div class="chunk-header" onclick="toggleChunk(${index})">
          <div class="chunk-title">
            <span class="chunk-icon">📄</span>
            <span class="chunk-name">${chunk.type}</span>
            <span class="chunk-count">${chunk.logs.length} 条</span>
          </div>
          <span class="toggle-icon" id="icon-${index}">▼</span>
        </div>
        <div class="chunk-content" id="content-${index}">
          ${chunk.logs.map((log) => {
            // 解析日志行，用颜色区分 "=>" 前后的内容
            const arrowIndex = log.rawLine.indexOf(' => ');
            if (arrowIndex > 0) {
              const prefix = log.rawLine.substring(0, arrowIndex)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
              const content = log.rawLine.substring(arrowIndex + 4)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
              return `<div class="log-line"><span class="log-prefix">${prefix}</span><span class="log-arrow"> => </span><span class="log-content">${content}</span></div>`;
            } else {
              // 如果没有 "=>"，直接显示
              const escapedLine = log.rawLine
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
              return `<div class="log-line">${escapedLine}</div>`;
            }
          }).join("")}
        </div>
      </div>
    `
      )
      .join("");

    // 返回 HTML 格式，纵向展示，带折叠功能
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
      background: #1a1a1a;
      min-height: 100vh;
      padding: 20px;
    }
    .header {
      background: rgba(40, 40, 40, 0.95);
      backdrop-filter: blur(10px);
      padding: 20px 30px;
      border-radius: 12px;
      margin-bottom: 20px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    h1 {
      color: #e0e0e0;
      font-size: 24px;
      margin-bottom: 10px;
    }
    .meta {
      color: #b0b0b0;
      font-size: 14px;
    }
    .meta strong {
      color: #8b9aff;
      font-weight: 600;
    }
    .logs-container {
      max-width: 1400px;
      margin: 0 auto;
    }
    .log-chunk {
      background: rgba(30, 30, 30, 0.98);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      margin-bottom: 20px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
      transition: all 0.3s ease;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .log-chunk:hover {
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.7);
      transform: translateY(-2px);
      border-color: rgba(255, 255, 255, 0.2);
    }
    .chunk-header {
      padding: 18px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #ffffff;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      user-select: none;
      transition: all 0.3s ease;
      border-bottom: 2px solid rgba(255, 255, 255, 0.1);
    }
    .chunk-header:hover {
      background: linear-gradient(135deg, #5568d3 0%, #653a8f 100%);
      box-shadow: inset 0 -2px 10px rgba(0, 0, 0, 0.1);
    }
    .chunk-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .chunk-icon {
      font-size: 18px;
    }
    .chunk-name {
      font-weight: 600;
      font-size: 16px;
      text-transform: capitalize;
      color: #ffffff;
      letter-spacing: 0.5px;
    }
    .chunk-count {
      background: rgba(255, 255, 255, 0.2);
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
    }
    .toggle-icon {
      font-size: 14px;
      transition: transform 0.3s ease;
    }
    .chunk-content {
      max-height: 600px;
      overflow-y: auto;
      padding: 20px;
      background: #252525;
      transition: max-height 0.3s ease, padding 0.3s ease;
    }
    .chunk-content.collapsed {
      max-height: 0;
      padding: 0 15px;
      overflow: hidden;
    }
    .chunk-content::-webkit-scrollbar {
      width: 8px;
    }
    .chunk-content::-webkit-scrollbar-track {
      background: #1a1a1a;
      border-radius: 4px;
    }
    .chunk-content::-webkit-scrollbar-thumb {
      background: #555;
      border-radius: 4px;
    }
    .chunk-content::-webkit-scrollbar-thumb:hover {
      background: #777;
    }
    .log-line {
      margin: 8px 0;
      padding: 12px 16px;
      background: #2a2a2a;
      border-left: 4px solid #667eea;
      border-radius: 6px;
      word-wrap: break-word;
      white-space: pre-wrap;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.8;
      color: #e0e0e0 !important;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
      transition: all 0.2s ease;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .log-line * {
      color: #e0e0e0 !important;
    }
    .log-line .log-prefix {
      color: #9cdcfe !important;
    }
    .log-line .log-arrow {
      color: #d4d4d4 !important;
      font-weight: bold;
    }
    .log-line .log-content {
      color: #ce9178 !important;
    }
    .log-line:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      transform: translateX(3px);
      border-left-color: #8b9aff;
      background: #333333;
    }
    .rotated {
      transform: rotate(180deg);
    }
  </style>
  <script>
    function toggleChunk(index) {
      const content = document.getElementById('content-' + index);
      const icon = document.getElementById('icon-' + index);
      content.classList.toggle('collapsed');
      icon.classList.toggle('rotated');
    }
  </script>
</head>
<body>
  <div class="header">
    <h1>📋 日志详情</h1>
    <div class="meta">
      <strong>应用:</strong> ${targetAppName} | <strong>日期:</strong> ${date} | <strong>TraceID:</strong> ${traceId} | 
      <strong>总计:</strong> ${totalLogs} 条日志 (${chunks.length} 个文件)
    </div>
  </div>
  <div class="logs-container">
    ${logChunksHtml}
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


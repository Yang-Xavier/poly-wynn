import { Request, Response } from "express";
import { getTradeLogs, formatTradeLogForDisplay } from "../services/logService";
import { TradeQueryParams } from "../types";

/**
 * Trade 控制器
 */

/**
 * 获取 trade 日志
 * GET /:appName/trade?date=yyyy-mm-dd
 */
export async function getTradeLogsHandler(
  req: Request<{ appName: string }, any, any, TradeQueryParams>,
  res: Response
): Promise<void> {
  try {
    const { appName } = req.params;
    const { date } = req.query;
    const logs = getTradeLogs(appName, date);

    // 获取基础 URL（用于生成链接）
    const protocol = req.protocol;
    const host = req.get("host");
    const baseUrl = `${protocol}://${host}`;

    // 格式化时间戳为 "yyyy-mm-dd HH:mm:ss.SSS" 格式（北京时间）
    const formatTimestampForUrl = (timestamp?: string): string | null => {
      if (!timestamp) return null;
      
      // timestamp 格式可能是 "[2026-01-04 22:13:06.703]" 或 "2026-01-04 22:13:06.703"
      const match = timestamp.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/);
      if (match) {
        const [, date, hour, minute, second, millisecond = '000'] = match;
        return `${date} ${hour}:${minute}:${second}.${millisecond.padEnd(3, '0')}`;
      }
      return null;
    };

    // 为每条日志添加链接
    const logsWithLinks = logs.map((log) => {
      const polymarketUrl = `https://polymarket.com/event/${encodeURIComponent(log.traceId)}`;
      const logUrl = `${baseUrl}/log?date=${log.date}&traceId=${encodeURIComponent(log.traceId)}&appName=${encodeURIComponent(appName)}`;
      
      // 格式化时间戳用于 data 路由
      const timeStr = formatTimestampForUrl(log.timestamp);
      const dataUrl = timeStr 
        ? `${baseUrl}/data/${encodeURIComponent(appName)}?date=${log.date}&traceId=${encodeURIComponent(log.traceId)}&time=${encodeURIComponent(timeStr)}`
        : `${baseUrl}/data/${encodeURIComponent(appName)}?date=${log.date}&traceId=${encodeURIComponent(log.traceId)}`;
      
      return {
        date: log.date,
        traceId: log.traceId,
        traceIdUrl: polymarketUrl,
        logUrl: logUrl,
        dataUrl: dataUrl,
        log: formatTradeLogForDisplay(log),
      };
    });

    // 返回 HTML 格式
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trade 日志 - ${appName} - ${date || "今天"}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
      margin: 20px;
      background-color: #1a1a1a;
      color: #e0e0e0;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: rgba(30, 30, 30, 0.95);
      padding: 20px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    h1 {
      color: #e0e0e0;
      border-bottom: 2px solid #4CAF50;
      padding-bottom: 10px;
    }
    .log-item {
      margin: 10px 0;
      padding: 12px 16px;
      background: #2a2a2a;
      border-left: 4px solid #4CAF50;
      border-radius: 6px;
      word-wrap: break-word;
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    }
    .log-item:hover {
      background: #333333;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    }
    .log-item a {
      color: #8b9aff;
      text-decoration: none;
      margin-left: 10px;
    }
    .log-item a:hover {
      text-decoration: underline;
      color: #a5b3ff;
    }
    .meta {
      color: #b0b0b0;
      font-size: 0.9em;
      margin-bottom: 8px;
    }
    .meta a {
      color: #FF6B35;
      font-weight: bold;
      text-decoration: none;
      margin-left: 0;
    }
    .meta a:hover {
      text-decoration: underline;
      color: #ff8c5a;
    }
    .count {
      color: #999;
      margin-bottom: 20px;
    }
    .log-content {
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.8;
      color: #e0e0e0;
    }
    .log-content .log-prefix {
      color: #9cdcfe !important;
    }
    .log-content .log-arrow {
      color: #d4d4d4 !important;
      font-weight: bold;
    }
    .log-content .log-message {
      color: #ce9178 !important;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Trade 日志 - ${appName}</h1>
    <div class="count">共 ${logsWithLinks.length} 条记录</div>
    ${logsWithLinks
      .map(
        (item) => `
      <div class="log-item">
        <div class="meta">日期: ${item.date} | 市场链接: <a href="${item.traceIdUrl}" target="_blank">${item.traceId}</a> | <a href="${item.logUrl}">查看详情</a> | <a href="${item.dataUrl}">查看数据</a></div>
        <div class="log-content">${(() => {
          // 转义 HTML 特殊字符
          const escaped = item.log
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          
          // 如果是多行日志，直接显示完整内容
          if (item.log.includes('\n')) {
            // 处理多行日志，为每行添加颜色区分
            const lines = item.log.split('\n');
            return lines.map((line, index) => {
              const lineEscaped = line
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
              
              if (index === 0) {
                // 第一行（时间戳行），用颜色区分 "=>" 前后的内容
                const arrowIndex = lineEscaped.indexOf(' => ');
                if (arrowIndex > 0) {
                  const prefix = lineEscaped.substring(0, arrowIndex);
                  const message = lineEscaped.substring(arrowIndex + 4);
                  return `<span class="log-prefix">${prefix}</span><span class="log-arrow"> => </span><span class="log-message">${message}</span>`;
                }
                return lineEscaped;
              }
              // 其他行，使用普通样式，保留缩进
              return lineEscaped ? `<div style="color: #ce9178; margin-left: 20px; white-space: pre;">${lineEscaped}</div>` : '<br>';
            }).join('');
          } else {
            // 单行日志，用颜色区分 "=>" 前后的内容
            const arrowIndex = escaped.indexOf(' => ');
            if (arrowIndex > 0) {
              const prefix = escaped.substring(0, arrowIndex);
              const message = escaped.substring(arrowIndex + 4);
              return `<span class="log-prefix">${prefix}</span><span class="log-arrow"> => </span><span class="log-message">${message}</span>`;
            }
            return escaped;
          }
        })()}</div>
      </div>
    `
      )
      .join("")}
  </div>
</body>
</html>
    `;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error) {
    console.error("获取 trade 日志失败:", error);
    res.status(500).json({ error: "获取日志失败" });
  }
}

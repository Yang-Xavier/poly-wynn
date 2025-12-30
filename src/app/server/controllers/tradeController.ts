import { Request, Response } from "express";
import { getTradeLogs, addLinkToTradeLog } from "../services/logService";
import { TradeQueryParams } from "../types";

/**
 * Trade 控制器
 */

/**
 * 获取 trade 日志
 * GET /trade?date=yyyy-mm-dd
 */
export async function getTradeLogsHandler(
  req: Request<{}, any, any, TradeQueryParams>,
  res: Response
): Promise<void> {
  try {
    const { date } = req.query;
    const logs = getTradeLogs(date);

    // 获取基础 URL（用于生成链接）
    const protocol = req.protocol;
    const host = req.get("host");
    const baseUrl = `${protocol}://${host}`;

    // 为每条日志添加链接
    const logsWithLinks = logs.map((log) => {
      const polymarketUrl = `https://polymarket.com/event/${encodeURIComponent(log.traceId)}`;
      return {
        date: log.date,
        traceId: log.traceId,
        traceIdUrl: polymarketUrl,
        log: addLinkToTradeLog(log, baseUrl),
      };
    });

    // 返回 HTML 格式
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trade 日志 - ${date || "今天"}</title>
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
      border-bottom: 2px solid #4CAF50;
      padding-bottom: 10px;
    }
    .log-item {
      margin: 10px 0;
      padding: 10px;
      background: #f9f9f9;
      border-left: 3px solid #4CAF50;
      word-wrap: break-word;
    }
    .log-item a {
      color: #2196F3;
      text-decoration: none;
      margin-left: 10px;
    }
    .log-item a:hover {
      text-decoration: underline;
    }
    .meta {
      color: #666;
      font-size: 0.9em;
      margin-bottom: 5px;
    }
    .meta a {
      color: #FF6B35;
      font-weight: bold;
      text-decoration: none;
      margin-left: 0;
    }
    .meta a:hover {
      text-decoration: underline;
      color: #E55A2B;
    }
    .count {
      color: #999;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Trade 日志</h1>
    <div class="count">共 ${logsWithLinks.length} 条记录</div>
    ${logsWithLinks
      .map(
        (item) => `
      <div class="log-item">
        <div class="meta">日期: ${item.date} | 市场链接: <a href="${item.traceIdUrl}" target="_blank">${item.traceId}</a></div>
        <div>${item.log}</div>
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

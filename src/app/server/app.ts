import express, { Express, Request, Response } from "express";
import routes from "./routes";

/**
 * Server 应用入口
 */

const app: Express = express();

// 基础中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 注册路由
app.use("/", routes);

// 根路径
app.get("/", (req: Request, res: Response) => {
  const protocol = req.protocol;
  const host = req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const today = new Date().toISOString().split("T")[0]; // 获取今天的日期作为示例

  res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>日志查看服务</title>
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
      color: #e0e0e0;
    }
    .container {
      max-width: 1000px;
      margin: 0 auto;
      background: rgba(30, 30, 30, 0.95);
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    h1 {
      color: #e0e0e0;
      font-size: 32px;
      margin-bottom: 30px;
      border-bottom: 2px solid #4CAF50;
      padding-bottom: 15px;
    }
    .routes-list {
      display: grid;
      gap: 15px;
    }
    .route-item {
      background: #2a2a2a;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #4CAF50;
      transition: all 0.3s ease;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .route-item:hover {
      background: #333333;
      transform: translateX(5px);
      border-left-color: #8b9aff;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
    .route-link {
      display: block;
      text-decoration: none;
      color: #e0e0e0;
    }
    .route-title {
      font-size: 18px;
      font-weight: 600;
      color: #8b9aff;
      margin-bottom: 8px;
    }
    .route-path {
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 14px;
      color: #ce9178;
      margin-bottom: 5px;
    }
    .route-desc {
      font-size: 13px;
      color: #b0b0b0;
      margin-top: 5px;
    }
    .route-example {
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 12px;
      color: #9cdcfe;
      background: rgba(0, 0, 0, 0.3);
      padding: 8px 12px;
      border-radius: 4px;
      margin-top: 8px;
      display: inline-block;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📋 日志查看服务</h1>
    <div class="routes-list">
      <div class="route-item">
        <a href="${baseUrl}/crypto15min/trade" class="route-link">
          <div class="route-title">📊 Crypto15min Trade 日志</div>
          <div class="route-path">/crypto15min/trade</div>
          <div class="route-desc">查看 crypto15min 应用的交易日志</div>
          <div class="route-example">?date=${today} (可选，默认今天)</div>
        </a>
      </div>
      <div class="route-item">
        <a href="${baseUrl}/spreadArbitrage/logs" class="route-link">
          <div class="route-title">🎯 SpreadArbitrage Chance 日志</div>
          <div class="route-path">/spreadArbitrage/logs</div>
          <div class="route-desc">查看 spreadArbitrage 应用的机会日志</div>
          <div class="route-example">?date=${today} (可选，默认今天)</div>
        </a>
      </div>
      <div class="route-item">
        <a href="${baseUrl}/log?date=${today}&traceId=eth-updown-15m-1767421800&appName=spreadArbitrage" class="route-link">
          <div class="route-title">📝 日志详情查看</div>
          <div class="route-path">/log</div>
          <div class="route-desc">查看指定 traceId 的所有日志文件（支持折叠展开）</div>
          <div class="route-example">?date=${today}&traceId=xxx&appName=xxx</div>
        </a>
      </div>
    </div>
  </div>
</body>
</html>
  `);
});

// 404 处理
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "路由不存在" });
});

// 错误处理
app.use((err: Error, req: Request, res: Response, next: any) => {
  console.error("服务器错误:", err);
  res.status(500).json({ error: "服务器内部错误" });
});

export default app;


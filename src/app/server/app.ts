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
  res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>日志查看服务</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: 50px auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      color: #333;
    }
    .link {
      display: block;
      margin: 15px 0;
      padding: 15px;
      background: #e3f2fd;
      border-left: 4px solid #2196F3;
      text-decoration: none;
      color: #1976D2;
      border-radius: 4px;
    }
    .link:hover {
      background: #bbdefb;
    }
    .example {
      color: #666;
      font-size: 0.9em;
      margin-top: 5px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📋 日志查看服务</h1>
    <a href="/crypto15min/trade" class="link">
      <strong>查看 Trade 日志</strong>
      <div class="example">/:appName/trade?date=yyyy-mm-dd (不传 date 则显示今天)</div>
    </a>
    <a href="/log?date=2026-01-03&traceId=btc-updown-15m-1767369600&appName=crypto15min" class="link">
      <strong>查看日志详情</strong>
      <div class="example">/log?date=yyyy-mm-dd&traceId=xxxx&appName=xxxx</div>
    </a>
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


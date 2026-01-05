import Koa from "koa";
import cors from "@koa/cors";
import bodyParser from "koa-bodyparser";
import path from "path";
import fs from "fs";
import routes from "./routes";

/**
 * Web 应用 Koa 服务器
 */

const app = new Koa();

// CORS 配置
app.use(
  cors({
    origin: process.env.NODE_ENV === "production" ? false : "*",
    credentials: true,
  })
);

// Body parser
app.use(bodyParser());

// 注册 API 路由
app.use(routes.routes()).use(routes.allowedMethods());

// 提供静态文件服务：/web/* 访问 dist/web/* 下的资源
const staticPath = path.join(process.cwd(), "dist", "web");
const staticDirExists = fs.existsSync(staticPath);

if (staticDirExists) {
  // 处理 /web/* 静态资源请求
  app.use(async (ctx, next) => {
    if (ctx.path.startsWith("/web")) {
      // 将 /web/* 映射到 dist/web/*
      // 例如：/web/index.html -> dist/web/index.html
      //      /web/assets/xxx.js -> dist/web/assets/xxx.js
      const relativePath = ctx.path.replace("/web", "").replace(/^\//, "") || "index.html";
      const filePath = path.join(staticPath, relativePath);

      // 安全检查：确保文件在 staticPath 目录内
      const resolvedPath = path.resolve(filePath);
      const resolvedStaticPath = path.resolve(staticPath);
      if (!resolvedPath.startsWith(resolvedStaticPath)) {
        ctx.status = 403;
        ctx.body = "禁止访问";
        return;
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        // 根据文件扩展名设置 Content-Type
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          ".html": "text/html",
          ".js": "application/javascript",
          ".css": "text/css",
          ".json": "application/json",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".gif": "image/gif",
          ".svg": "image/svg+xml",
          ".ico": "image/x-icon",
          ".woff": "font/woff",
          ".woff2": "font/woff2",
          ".ttf": "font/ttf",
          ".eot": "application/vnd.ms-fontobject",
        };
        ctx.type = mimeTypes[ext] || "application/octet-stream";
        ctx.body = fs.readFileSync(filePath);
        ctx.status = 200;
      } else {
        ctx.status = 404;
        ctx.body = "文件未找到";
      }
    } else {
      await next();
    }
  });
} else {
  console.warn(`警告: 静态文件目录不存在: ${staticPath}`);
  console.warn("请先运行 npm run build 构建前端应用");
}

// 错误处理
app.on("error", (err, ctx) => {
  console.error("服务器错误:", err);
  ctx.status = err.statusCode || err.status || 500;
  ctx.body = {
    error: err.message || "服务器内部错误",
  };
});

export default app;

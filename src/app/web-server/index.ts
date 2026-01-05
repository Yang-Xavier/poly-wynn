import app from "./app";

/**
 * 启动 Web 服务器
 */
const PORT = process.env.WEB_PORT || 8080;

const server = app.listen(PORT, () => {
  console.log(`🌐 Web 服务器运行在 http://localhost:${PORT}`);
  console.log(`📡 API 端点: http://localhost:${PORT}/api`);
});

// 错误处理
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`❌ 端口 ${PORT} 已被占用，请关闭占用该端口的进程或使用其他端口`);
    console.error(`💡 提示: 可以通过环境变量 WEB_PORT 指定其他端口，例如: WEB_PORT=3000 npm run web:server`);
    process.exit(1);
  } else {
    console.error("❌ 服务器启动失败:", err);
    process.exit(1);
  }
});

// 优雅关闭
process.on("SIGTERM", () => {
  console.log("SIGTERM 信号 received: 关闭 Web 服务器");
  server.close(() => {
    console.log("Web 服务器已关闭");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT 信号 received: 关闭 Web 服务器");
  server.close(() => {
    console.log("Web 服务器已关闭");
    process.exit(0);
  });
});


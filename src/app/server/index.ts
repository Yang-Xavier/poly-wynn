import app from "./app";

/**
 * 启动服务器
 */
const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, () => {
  console.log(`🚀 Server 运行在 http://localhost:${PORT}`);
});

// 优雅关闭
process.on("SIGTERM", () => {
  console.log("SIGTERM 信号 received: 关闭服务器");
  server.close(() => {
    console.log("服务器已关闭");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT 信号 received: 关闭服务器");
  server.close(() => {
    console.log("服务器已关闭");
    process.exit(0);
  });
});

#!/usr/bin/env node

/**
 * PM2 启动脚本
 * 支持通过 -p 参数传递 password，或从 .env 文件、环境变量读取
 *
 * 使用方法：
 * node ./scripts/pm2-start.js -p your_password
 * 或者
 * node ./scripts/pm2-start.js -p=your_password
 */

const { spawn } = require("child_process");
const path = require("path");
const { parseAndGetPassword } = require("../src/shared/getPassword");

// 解析命令行参数并获取密码
// 优先级：命令行 -p > .env 文件 > 环境变量
const args = process.argv.slice(2);
const { password, remainingArgs } = parseAndGetPassword(args, false);

// 准备环境变量
const env = { ...process.env };
if (password) {
  env.PASSWORD = password;
  console.log("[PM2 Start] 已设置 PASSWORD 环境变量");
} else {
  console.warn("[PM2 Start] 警告: 未找到 PASSWORD，子应用可能无法正常工作");
}

// 启动 PM2
const ecosystemPath = path.join(__dirname, "../", "ecosystem.config.js");
const pm2Args = ["start", ecosystemPath, ...remainingArgs];

console.log("[PM2 Start] 启动命令: pm2", pm2Args.join(" "));

const pm2Process = spawn("pm2", pm2Args, {
  env,
  stdio: "inherit",
  shell: true,
});

pm2Process.on("error", (error) => {
  console.error("[PM2 Start] 启动失败:", error);
  process.exit(1);
});

pm2Process.on("exit", (code) => {
  process.exit(code || 0);
});

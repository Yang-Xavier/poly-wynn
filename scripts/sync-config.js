const { syncConfig } = require("../dist/shared/encryptConfig");
const { parseAndGetPassword } = require("./getPassword");

/**
 * 主函数
 */
function main() {
  try {
    // 从命令行参数解析并获取密码
    // 优先级：命令行 -p > .env 文件 > 环境变量
    const args = process.argv.slice(2);
    const { password } = parseAndGetPassword(args, true);

    if (!password) {
      console.error("错误: 无法获取加密密钥");
      console.error("使用方法: npm run syncConfig -p <密钥>");
      console.error("或者设置环境变量 PASSWORD 或在 .env 文件中设置 PASSWORD=your_password");
      process.exit(1);
    }

    console.log("=== 同步加密配置文件 ===\n");
    console.log("开始同步配置文件...\n");

    // 执行同步
    syncConfig();

    console.log("\n✓ 配置文件同步完成！");
  } catch (error) {
    console.error("\n✗ 同步失败:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// 执行主函数
main();

module.exports = { main };

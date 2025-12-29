/**
 * 程序启动入口
 * 与 pm2 结合使用，通过命令行启动
 * 负责命令接收、参数解析和功能调用
 *
 * 支持格式：
 * - bun src/boostApp.ts <app>:<command>
 * - bun src/boostApp.ts crypto15min:runPolyWynn
 * - bun src/boostApp.ts crypto15min:runPolyWynn -p your_password
 *
 * 参数说明：
 * - -p: 加密密钥，将设置到环境变量 ENCRYPTION_KEY
 * - 如果没有提供 -p 参数，将从 .env 文件或环境变量 PASSWORD 中读取（优先级：.env > 环境变量）
 */

import { debug as crypto15minDebug } from "./app/crypto15min/debug";
import { runPolyWynn as crypto15minRunPolyWynn } from "./app/crypto15min/polyWynn";
import { redeem as crypto15minRedeem } from "./app/crypto15min/redeem";
import { parsePasswordArg, getPassword } from "./shared/getPassword";

// 应用类型定义
type App = "crypto15min";

// 命令类型定义
type Command = "runPolyWynn" | "redeem" | "debug";

// 命令参数接口
interface CommandArgs {
  app: App;
  command: Command;
  password?: string;
}

/**
 * 解析命令行参数
 * 支持格式：
 * - bun src/boostApp.ts <app>:<command>
 * - bun src/boostApp.ts crypto15min:runPolyWynn
 * - bun src/boostApp.ts crypto15min:redeem
 */
function parseArgs(): CommandArgs {
  const args = process.argv.slice(2); // 移除 'bun' 和脚本路径

  if (args.length === 0) {
    throw new Error("请提供命令参数。格式: <app>:<command>，例如: crypto15min:runPolyWynn");
  }

  const commandStr = args[0];
  const [app, command] = commandStr.split(":");

  if (!app || !command) {
    throw new Error(
      `命令格式错误: ${commandStr}。正确格式: <app>:<command>，例如: crypto15min:runPolyWynn`
    );
  }

  if (!["crypto15min"].includes(app)) {
    throw new Error(`未知应用: ${app}。支持的应用: crypto15min`);
  }

  if (!["runPolyWynn", "redeem", "debug"].includes(command)) {
    throw new Error(`未知命令: ${command}。支持的命令: runPolyWynn, redeem, debug`);
  }

  // 解析 -p 参数
  const { password, remainingArgs } = parsePasswordArg(args.slice(1));

  const parsedArgs: CommandArgs = {
    app: app as App,
    command: command as Command,
    password: password || undefined,
  };

  return parsedArgs;
}

/**
 * 主函数：解析参数并调用对应功能
 */
async function main(): Promise<void> {
  try {
    // 解析命令行参数
    const args = parseArgs();
    console.log(`[Bootstrap] 解析到应用: ${args.app}, 命令: ${args.command}`);

    // 获取密码：优先从命令行参数，其次从 .env 文件，最后从环境变量
    // 如果都没有则抛出错误
    const password = getPassword(args.password, undefined, true);
    if (!password) {
      throw new Error("无法获取密码");
    }
    process.env.PASSWORD = password;
    console.log(`[Bootstrap] 已设置环境变量 PASSWORD`);

    // 根据应用和命令调用对应功能
    if (args.app === "crypto15min") {
      switch (args.command) {
        case "runPolyWynn":
          await crypto15minRunPolyWynn();
          break;
        case "redeem":
          await crypto15minRedeem();
          break;
        case "debug":
          await crypto15minDebug();
          break;
        default:
          throw new Error(`未知命令: ${args.command}`);
      }
    } else {
      throw new Error(`未知应用: ${args.app}`);
    }
  } catch (error) {
    console.error(`[Bootstrap] 程序执行失败: ${error}`);
    console.error("错误详情:", error);
    process.exit(1);
  }
}

// 如果直接运行此文件，执行主函数
if (require.main === module) {
  main().catch((error) => {
    console.error("未捕获的错误:", error);
    process.exit(1);
  });
}

export { main, parseArgs };

/**
 * 程序启动入口
 * 与 pm2 结合使用，通过命令行启动
 * 负责命令接收、参数解析和功能调用
 */

import { debug } from "./debug";
import { runPolyWynn } from "./polyWynn";
import { redeem } from "./redeem";


// 命令类型定义
type Command = "runPolyWynn" | "redeem" | "debug";

// 命令参数接口
interface CommandArgs {
    command: Command;
    [key: string]: any;
}

/**
 * 解析命令行参数
 * 支持格式：
 * - node bootstrap.js runPolyWynn
 * - node bootstrap.js redeem <conditionId>
 */
function parseArgs(): CommandArgs {
    const args = process.argv.slice(2); // 移除 'node' 和脚本路径

    if (args.length === 0) {
        throw new Error("请提供命令参数。支持的命令: runPolyWynn, redeem, debug");
    }

    const command = args[0] as Command;
    const parsedArgs: CommandArgs = { command };

    // redeem 命令：第二个参数作为 position 参数传入的 conditionId
    if (command === "redeem") {
        if (args.length < 2) {
            throw new Error("redeem 命令需要提供 conditionId 参数，例如: node bootstrap.js redeem <conditionId>");
        }
        parsedArgs.conditionId = args[1];
        return parsedArgs;
    }

    // 其他命令如果将来需要，可继续使用 --key=value 或 --key value 的形式解析
    for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith("--")) {
            const [key, value] = arg.substring(2).split("=");
            if (value !== undefined) {
                parsedArgs[key] = value;
            } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
                parsedArgs[key] = args[++i];
            } else {
                parsedArgs[key] = true; // 布尔标志
            }
        }
    }

    return parsedArgs;
}

/**
 * 主函数：解析参数并调用对应功能
 */
async function main(): Promise<void> {
    try {
        // 解析命令行参数
        const args = parseArgs();
        console.log(`[Bootstrap] 解析到命令: ${args.command}`);
        console.log(`[Bootstrap] 完整参数: ${JSON.stringify(args, null, 2)}`);

        // 根据命令调用对应功能
        switch (args.command) {
            case "runPolyWynn":
                await runPolyWynn();
                break;
            case "redeem":
                await redeem(args.conditionId);
                break;
            case "debug":
                await debug();
                break;
            default:
                throw new Error(`未知命令: ${args.command}。支持的命令: runPolyWynn, redeem`);
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

export { main, parseArgs, runPolyWynn, redeem };


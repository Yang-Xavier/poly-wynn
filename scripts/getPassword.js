const fs = require("fs");
const path = require("path");

/**
 * 从 .env 文件读取环境变量
 * @param {string} envPath .env 文件路径，如果不提供则从项目根目录查找
 * @returns {Record<string, string>} 环境变量对象
 */
function loadEnvFile(envPath) {
  const targetPath = envPath || path.join(process.cwd(), ".env");
  const env = {};

  if (!fs.existsSync(targetPath)) {
    return env;
  }

  try {
    const content = fs.readFileSync(targetPath, "utf8");
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmedLine = line.trim();
      // 跳过空行和注释
      if (!trimmedLine || trimmedLine.startsWith("#")) {
        continue;
      }

      // 解析 KEY=VALUE 格式
      const equalIndex = trimmedLine.indexOf("=");
      if (equalIndex > 0) {
        const key = trimmedLine.substring(0, equalIndex).trim();
        let value = trimmedLine.substring(equalIndex + 1).trim();

        // 移除引号（如果存在）
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        env[key] = value;
      }
    }
  } catch (error) {
    console.warn(`读取 .env 文件失败: ${error}`);
  }

  return env;
}

/**
 * 从命令行参数中解析 -p 参数
 * 支持格式：
 * - -p value
 * - -p=value
 * @param {string[]} args 命令行参数数组（通常是 process.argv.slice(2)）
 * @returns {{ password: string | null, remainingArgs: string[] }} 返回解析到的密码值和剩余的参数数组
 */
function parsePasswordArg(args) {
  const remainingArgs = [];
  let password = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-p" && i + 1 < args.length) {
      // -p value 格式
      password = args[i + 1];
      i++; // 跳过下一个参数（密码值）
    } else if (arg.startsWith("-p=")) {
      // -p=value 格式
      password = arg.substring(3);
    } else {
      // 保留其他参数
      remainingArgs.push(arg);
    }
  }

  return { password, remainingArgs };
}

/**
 * 获取密码：按优先级从多个来源获取
 * 优先级顺序：
 * 1. 命令行 -p 参数
 * 2. .env 文件中的 PASSWORD
 * 3. 环境变量 PASSWORD
 *
 * @param {string | null} passwordFromArgs 命令行参数中的密码（可选）
 * @param {string} envPath .env 文件路径（可选，默认从项目根目录查找）
 * @param {boolean} throwIfNotFound 如果所有来源都没有找到密码，是否抛出错误（默认 false）
 * @returns {string | null} 密码字符串，如果未找到且 throwIfNotFound 为 false 则返回 null
 * @throws 如果所有来源都没有密码且 throwIfNotFound 为 true 则抛出错误
 */
function getPassword(passwordFromArgs, envPath, throwIfNotFound = false) {
  // 1. 优先使用命令行参数
  if (passwordFromArgs) {
    return passwordFromArgs;
  }

  // 2. 从 .env 文件读取
  const env = loadEnvFile(envPath);
  if (env.PASSWORD) {
    return env.PASSWORD;
  }

  // 3. 从环境变量读取
  if (process.env.PASSWORD) {
    return process.env.PASSWORD;
  }

  // 4. 如果都没有
  if (throwIfNotFound) {
    throw new Error(
      "未找到密码。请通过以下方式之一提供密码：\n" +
        "  1. 使用 -p 参数: -p your_password\n" +
        "  2. 设置环境变量 PASSWORD\n" +
        "  3. 在 .env 文件中设置 PASSWORD=your_password"
    );
  }

  return null;
}

/**
 * 从命令行参数中解析并获取密码（便捷方法）
 * 结合了 parsePasswordArg 和 getPassword 的功能
 *
 * @param {string[]} args 命令行参数数组（通常是 process.argv.slice(2)）
 * @param {boolean} throwIfNotFound 如果所有来源都没有找到密码，是否抛出错误（默认 false）
 * @returns {{ password: string | null, remainingArgs: string[] }} 返回解析到的密码、剩余参数和密码值
 */
function parseAndGetPassword(args, throwIfNotFound = false) {
  const { password: passwordFromArgs, remainingArgs } = parsePasswordArg(args);
  const password = getPassword(passwordFromArgs, undefined, throwIfNotFound);

  return { password, remainingArgs };
}

module.exports = {
  loadEnvFile,
  parsePasswordArg,
  getPassword,
  parseAndGetPassword,
};


import Router from "@koa/router";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const router = new Router();

/**
 * API 路由
 */

// 健康检查
router.get("/health", async (ctx) => {
  ctx.body = {
    success: true,
    status: "ok",
    message: "服务器运行正常",
    timestamp: new Date().toISOString(),
  };
});

/**
 * 获取数据文件
 * GET /api/data?appName=xxx&date=xxx&traceId=xxx
 * 返回 data/appName/date/traceId_data.json 中的所有数据
 */
router.get("/data", async (ctx) => {
  const { appName, date, traceId } = ctx.query;

  if (!appName || !date || !traceId) {
    ctx.status = 400;
    ctx.body = {
      success: false,
      error: "缺少必需参数: appName, date, traceId",
    };
    return;
  }

  try {
    const dataDir = path.join(process.cwd(), "data");
    const filePath = path.join(dataDir, appName as string, `${date}_${traceId}_data.json`);

    if (!fs.existsSync(filePath)) {
      ctx.status = 404;
      ctx.body = {
        success: false,
        error: "数据文件不存在",
        filename: `${date}_${traceId}_data.json`,
      };
      return;
    }

    const fileContent = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(fileContent);

    ctx.body = {
      success: true,
      data,
    };
  } catch (error) {
    ctx.status = 500;
    ctx.body = {
      success: false,
      error: error instanceof Error ? error.message : "读取数据文件失败",
    };
  }
});

/**
 * 获取报告文件
 * GET /api/report?appName=xxx&date=xxx
 * 返回 report/appName/date_report.json 中的所有数据
 */
router.get("/report", async (ctx) => {
  const { appName, date } = ctx.query;

  if (!appName || !date) {
    ctx.status = 400;
    ctx.body = {
      success: false,
      error: "缺少必需参数: appName, date",
    };
    return;
  }

  try {
    const reportDir = path.join(process.cwd(), "report");
    const filePath = path.join(reportDir, appName as string, `${date}_report.json`);

    if (!fs.existsSync(filePath)) {
      ctx.status = 404;
      ctx.body = {
        success: false,
        error: "报告文件不存在",
        filename: `${date}_report.json`,
      };
      return;
    }

    const fileContent = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(fileContent);

    ctx.body = {
      success: true,
      data,
    };
  } catch (error) {
    ctx.status = 500;
    ctx.body = {
      success: false,
      error: error instanceof Error ? error.message : "读取报告文件失败",
    };
  }
});

/**
 * 获取日志文件
 * GET /api/log?appName=xxx&date=xxx&traceId=xxx
 * 返回 logs/appName/ 目录下所有匹配 date_traceId_*.log 格式的文件，按 type 分类返回
 */
router.get("/log", async (ctx) => {
  const { appName, date, traceId } = ctx.query;

  if (!appName || !date || !traceId) {
    ctx.status = 400;
    ctx.body = {
      success: false,
      error: "缺少必需参数: appName, date, traceId",
    };
    return;
  }

  try {
    const logsDir = path.join(process.cwd(), "logs");
    const logDirPath = path.join(logsDir, appName as string);

    if (!fs.existsSync(logDirPath)) {
      ctx.status = 404;
      ctx.body = {
        success: false,
        error: "日志目录不存在",
        path: logDirPath,
      };
      return;
    }

    // 构建文件名前缀：date_traceId_
    const filePrefix = `${date}_${traceId}_`;

    // 读取目录下所有匹配 date_traceId_*.log 格式的文件
    const files = fs.readdirSync(logDirPath);
    const logFiles = files.filter((file) => file.startsWith(filePrefix) && file.endsWith(".log"));

    if (logFiles.length === 0) {
      ctx.body = {
        success: true,
        data: {},
      };
      return;
    }

    // 按文件名中提取的 type 分类读取日志内容
    // 使用 utf-8 编码读取，确保保留所有换行符（\n）和原始格式
    const logs: Record<string, string> = {};
    for (const file of logFiles) {
      // 从文件名 date_traceId_type.log 中提取 type
      // 去掉前缀 date_traceId_ 和后缀 .log
      const type = file.replace(filePrefix, "").replace(/\.log$/, "");
      const filePath = path.join(logDirPath, file);
      // 读取文件内容，保留所有换行符和原始格式
      let content = fs.readFileSync(filePath, { encoding: "utf-8", flag: "r" });

      // 确保每行之间都有换行符：如果文件内容不为空且末尾没有换行符，添加一个
      // 同时确保内容中的每一行都以换行符结尾（除了最后一行）
      if (content && !content.endsWith("\n")) {
        content += "\n";
      }

      logs[type] = content;
    }

    ctx.body = {
      success: true,
      data: logs,
    };
  } catch (error) {
    ctx.status = 500;
    ctx.body = {
      success: false,
      error: error instanceof Error ? error.message : "读取日志文件失败",
    };
  }
});

/**
 * 获取 PM2 进程状态
 * GET /api/process?appName=xxx
 * 功能：获取 appName 在 pm2 中的进程状态
 */
router.get("/process", async (ctx) => {
  const { appName } = ctx.query;

  if (!appName) {
    ctx.status = 400;
    ctx.body = {
      success: false,
      error: "缺少必需参数: appName",
    };
    return;
  }

  try {
    // 验证 appName 是否存在于 logs 目录中
    const logsDir = path.join(process.cwd(), "logs");
    const appLogDir = path.join(logsDir, appName as string);

    if (!fs.existsSync(appLogDir)) {
      ctx.status = 400;
      ctx.body = {
        success: false,
        error: `appName '${appName}' 不存在于 logs 目录中`,
      };
      return;
    }

    const stats = fs.statSync(appLogDir);
    if (!stats.isDirectory()) {
      ctx.status = 400;
      ctx.body = {
        success: false,
        error: `appName '${appName}' 不是一个有效的目录`,
      };
      return;
    }

    // 执行 pm2 jlist 获取所有进程信息（JSON 格式）
    const command = `pm2 jlist`;

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        timeout: 10000,
      });

      // 验证 stdout 是否为空或无效
      if (!stdout || stdout.trim().length === 0) {
        console.error("pm2 jlist 返回空结果");
        ctx.status = 500;
        ctx.body = {
          success: false,
          error: "pm2 jlist 返回空结果",
          stderr: stderr || "",
        };
        return;
      }

      // 解析 JSON 输出
      let processes: any[];
      try {
        processes = JSON.parse(stdout.trim());
      } catch (parseError) {
        console.error("解析 pm2 jlist JSON 失败:", parseError);
        console.error("stdout:", stdout);
        ctx.status = 500;
        ctx.body = {
          success: false,
          error: "解析 pm2 进程列表失败",
          stdout: stdout.substring(0, 500), // 只返回前500个字符
          stderr: stderr || "",
        };
        return;
      }

      // 确保 processes 是数组
      if (!Array.isArray(processes)) {
        console.error("pm2 jlist 返回的不是数组:", typeof processes);
        ctx.status = 500;
        ctx.body = {
          success: false,
          error: "pm2 进程列表格式错误",
        };
        return;
      }

      // 查找匹配的进程
      // 首先尝试精确匹配 logs 目录名
      let targetProcess = processes.find((proc: any) => proc.name === (appName as string));

      // 如果精确匹配失败，尝试模糊匹配（例如: crypto15min 匹配 crypto15min-eth）
      if (!targetProcess) {
        targetProcess = processes.find((proc: any) => {
          const procName = proc.name || "";
          return (
            procName.startsWith((appName as string) + "-") ||
            procName === appName ||
            appName.startsWith(procName)
          );
        });
      }

      if (!targetProcess) {
        ctx.body = {
          success: true,
          appName: appName as string,
          status: "not_found",
          message: `进程 '${appName}' 在 pm2 中不存在`,
          process: null,
        };
        return;
      }

      // 返回进程状态信息
      ctx.body = {
        success: true,
        appName: appName as string,
        status: targetProcess.pm2_env?.status || "unknown",
        process: {
          name: targetProcess.name,
          pid: targetProcess.pid,
          pmId: targetProcess.pm_id,
          status: targetProcess.pm2_env?.status,
          uptime: targetProcess.pm2_env?.pm_uptime,
          restarts: targetProcess.pm2_env?.restart_time,
          cpu: targetProcess.monit?.cpu,
          memory: targetProcess.monit?.memory,
        },
      };
    } catch (execError: any) {
      const errorMessage = execError.message || "获取进程状态失败";
      console.error("执行 pm2 jlist 失败:", errorMessage);
      console.error("stderr:", execError.stderr || "");
      console.error("stdout:", execError.stdout || "");
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: errorMessage,
        stdout: execError.stdout || "",
        stderr: execError.stderr || "",
      };
    }
  } catch (error) {
    console.error("获取进程状态时发生错误:", error);
    ctx.status = 500;
    ctx.body = {
      success: false,
      error: error instanceof Error ? error.message : "获取进程状态失败",
      details: error instanceof Error ? error.stack : undefined,
    };
  }
});

/**
 * 控制 PM2 进程
 * POST /api/process?appName=xxx
 * 请求体: { action: "start" | "stop" }
 * 功能：执行 pm2 start/stop 命令，appName 必须是 logs 目录下存在的目录名
 */
router.post("/process", async (ctx) => {
  const { appName } = ctx.query;
  const { action } = ctx.request.body as { action?: string };

  // 验证必需参数
  if (!action || !appName) {
    ctx.status = 400;
    ctx.body = {
      success: false,
      error: "缺少必需参数: action (body), appName (query)",
    };
    return;
  }

  // 验证 action 是否为 start 或 stop
  if (action !== "start" && action !== "stop") {
    ctx.status = 400;
    ctx.body = {
      success: false,
      error: "action 参数只能是 'start' 或 'stop'",
    };
    return;
  }

  try {
    // 验证 appName 是否存在于 logs 目录中
    const logsDir = path.join(process.cwd(), "logs");
    const appLogDir = path.join(logsDir, appName as string);

    // 检查是否为目录（排除文件）
    if (!fs.existsSync(appLogDir)) {
      ctx.status = 400;
      ctx.body = {
        success: false,
        error: `appName '${appName}' 不存在于 logs 目录中`,
      };
      return;
    }

    const stats = fs.statSync(appLogDir);
    if (!stats.isDirectory()) {
      ctx.status = 400;
      ctx.body = {
        success: false,
        error: `appName '${appName}' 不是一个有效的目录`,
      };
      return;
    }

    // 查找实际的 PM2 应用名
    // 因为 logs 目录名可能和 PM2 应用名不一致（例如: crypto15min vs crypto15min-eth）
    let pm2AppName = appName as string;

    try {
      // 如果是 stop 操作，需要先查找实际的 PM2 应用名
      if (action === "stop") {
        const { stdout } = await execAsync("pm2 jlist", {
          cwd: process.cwd(),
          timeout: 5000,
        });

        if (stdout && stdout.trim()) {
          try {
            const processes = JSON.parse(stdout.trim()) as any[];
            // 尝试精确匹配
            let targetProcess = processes.find((proc: any) => proc.name === pm2AppName);

            // 如果精确匹配失败，尝试模糊匹配
            if (!targetProcess) {
              targetProcess = processes.find((proc: any) => {
                const procName = proc.name || "";
                return procName.startsWith(pm2AppName + "-");
              });
            }

            // 如果找到匹配的进程，使用实际的 PM2 应用名
            if (targetProcess && targetProcess.name) {
              pm2AppName = targetProcess.name;
            } else {
              // stop 操作：如果找不到匹配的进程，返回错误
              ctx.status = 400;
              ctx.body = {
                success: false,
                error: `未找到匹配的 PM2 进程: ${appName}`,
                availableProcesses: processes.map((p: any) => p.name),
              };
              return;
            }
          } catch (parseError) {
            // JSON 解析失败
            console.error("解析 pm2 进程列表失败:", parseError);
            ctx.status = 500;
            ctx.body = {
              success: false,
              error: "无法解析 PM2 进程列表",
            };
            return;
          }
        } else {
          // stdout 为空，对于 stop 操作返回错误
          ctx.status = 400;
          ctx.body = {
            success: false,
            error: `未找到匹配的 PM2 进程: ${appName}`,
          };
          return;
        }
      } else {
        // start 操作：尝试查找可能的 PM2 应用名
        // 先检查是否有匹配的应用名（用于验证）
        const { stdout } = await execAsync("pm2 jlist", {
          cwd: process.cwd(),
          timeout: 5000,
        }).catch(() => ({ stdout: "[]" }));

        if (stdout && stdout.trim()) {
          try {
            const processes = JSON.parse(stdout.trim()) as any[];
            // 查找匹配的应用名
            const targetProcess = processes.find((proc: any) => {
              const procName = proc.name || "";
              return (
                procName.startsWith(pm2AppName + "-") ||
                procName === pm2AppName ||
                pm2AppName.startsWith(procName)
              );
            });

            // 如果找到匹配的进程，使用实际的 PM2 应用名
            if (targetProcess && targetProcess.name) {
              pm2AppName = targetProcess.name;
            }
          } catch (parseError) {
            // JSON 解析失败，使用原始的 appName
            console.warn("解析 pm2 进程列表失败，使用原始 appName:", parseError);
          }
        }
      }
    } catch (listError: any) {
      // 获取进程列表失败
      console.error("获取 pm2 进程列表失败:", listError);
      if (action === "stop") {
        ctx.status = 500;
        ctx.body = {
          success: false,
          error: "无法获取 PM2 进程列表",
          stderr: listError.stderr || "",
        };
        return;
      }
      // start 操作：即使获取列表失败，也可以尝试执行 start
      console.warn("获取 pm2 进程列表失败，尝试使用原始 appName:", pm2AppName);
    }

    // 执行 pm2 命令
    const command = `pm2 ${action} ${pm2AppName}`;
    console.log(`执行 PM2 命令: ${command}`);

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        timeout: 10000, // 10秒超时
      });

      // 返回执行结果
      ctx.status = 200;
      ctx.body = {
        success: true,
        command,
        stdout: stdout || "",
        stderr: stderr || "",
        message: `pm2 ${action} ${pm2AppName} 执行成功`,
      };
    } catch (execError: any) {
      // execAsync 失败时，错误对象包含 stdout 和 stderr
      const stdout = execError.stdout || "";
      const stderr = execError.stderr || "";
      const errorMessage = execError.message || "执行命令失败";

      console.error(`执行 PM2 命令失败: ${command}`);
      console.error("错误信息:", errorMessage);
      console.error("stderr:", stderr);
      console.error("stdout:", stdout);

      // 即使命令执行失败（退出码非0），也返回结果，但标记为失败
      // 返回 200 状态码以便客户端可以获取完整的 stdout 和 stderr 信息
      ctx.status = 200;
      ctx.body = {
        success: false,
        command,
        stdout: stdout || "",
        stderr: stderr || "",
        error: errorMessage,
      };
    }
  } catch (error) {
    ctx.status = 500;
    ctx.body = {
      success: false,
      error: error instanceof Error ? error.message : "执行命令失败",
    };
  }
});

export default router;

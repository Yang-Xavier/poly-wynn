import Router from "@koa/router";
import fs from "fs";
import path from "path";

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
    const filePath = path.join(dataDir, appName as string, date as string, `${traceId}_data.json`);

    if (!fs.existsSync(filePath)) {
      ctx.status = 404;
      ctx.body = {
        success: false,
        error: "数据文件不存在",
        path: filePath,
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
        path: filePath,
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
 * 返回 logs/appName/date/traceId/ 目录下所有 .log 文件，按文件名（去掉 .log 后缀）分类返回
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
    const logDirPath = path.join(logsDir, appName as string, date as string, traceId as string);

    if (!fs.existsSync(logDirPath)) {
      ctx.status = 404;
      ctx.body = {
        success: false,
        error: "日志目录不存在",
        path: logDirPath,
      };
      return;
    }

    // 读取目录下所有 .log 文件
    const files = fs.readdirSync(logDirPath);
    const logFiles = files.filter((file) => file.endsWith(".log"));

    if (logFiles.length === 0) {
      ctx.body = {
        success: true,
        data: {},
      };
      return;
    }

    // 按文件名（去掉 .log 后缀）分类读取日志内容
    // 使用 utf-8 编码读取，确保保留所有换行符（\n）和原始格式
    const logs: Record<string, string> = {};
    for (const file of logFiles) {
      const type = file.replace(/\.log$/, "");
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

export default router;


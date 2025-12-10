const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// 根目录为当前项目下的 logs 目录
const LOGS_ROOT = path.join(__dirname, 'logs');

const fsPromises = fs.promises;

// 日志类型的显示顺序
const LOG_TYPE_ORDER = ['trade', 'info', 'error', 'data'];

function sendError(res, statusCode, message) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`${statusCode} ${message}\n`);
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 查找最新日期目录下的 trade.log 文件
 */
async function findLatestTradeLogPath() {
  let entries;
  try {
    entries = await fsPromises.readdir(LOGS_ROOT, { withFileTypes: true });
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      throw new Error('日志根目录不存在');
    }
    throw e;
  }

  const dateDirs = entries
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    // 名字本身就是日期，按倒序即最新在前
    .sort((a, b) => b.name.localeCompare(a.name, 'en'))
    .map((d) => d.name);

  for (const dir of dateDirs) {
    const tradePath = path.join(LOGS_ROOT, dir, 'trade.log');
    try {
      await fsPromises.access(tradePath, fs.constants.F_OK);
      return tradePath;
    } catch (e) {
      // 当前日期没有 trade.log，继续往前找
    }
  }

  throw new Error('未找到任何 trade.log 日志文件');
}

/**
 * 处理 /log/trade 路由：返回最新 trade.log 的完整内容
 */
async function handleLatestTrade(res) {
  try {
    const latestTradePath = await findLatestTradeLogPath();
    const content = await fsPromises.readFile(latestTradePath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(content);
  } catch (e) {
    console.error('读取最新 trade.log 失败:', e);
    sendError(res, 500, e.message || '读取最新 trade.log 失败');
  }
}

/**
 * 读取指定日期目录下所有日志文件（排除 price*），并按 traceId 过滤
 * 返回结构：{ [logType: string]: string[] }，logType 为文件名去掉 .log 的部分
 */
async function collectLogsByTraceId(date, traceId) {
  const dayDir = path.join(LOGS_ROOT, date);

  // 安全校验，避免路径穿越
  const normalized = path.normalize(dayDir);
  if (!normalized.startsWith(LOGS_ROOT)) {
    throw new Error('非法日期路径');
  }

  let entries;
  try {
    entries = await fsPromises.readdir(dayDir, { withFileTypes: true });
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      throw new Error(`日期目录不存在: ${date}`);
    }
    throw e;
  }

  const result = {};

  const logFiles = entries.filter(
    (f) =>
      f.isFile() &&
      f.name.endsWith('.log') &&
      // 排除 price 相关日志（price.log 或 price-xxx.log）
      !/^price(\.|-)/.test(f.name),
  );

  // 日志中 TraceID 统一格式为：[TraceID: xxx]
  const tracePattern = `[TraceID: ${traceId}]`;

  await Promise.all(
    logFiles.map(async (entry) => {
      const filePath = path.join(dayDir, entry.name);
      const logType = entry.name.replace(/\.log$/i, '');
      try {
        const content = await fsPromises.readFile(filePath, 'utf8');
        const lines = content
          .split(/\r?\n/)
          .filter((line) => line && line.includes(tracePattern));
        if (lines.length > 0) {
          result[logType] = lines;
        }
      } catch (e) {
        console.error(`读取日志文件失败: ${filePath}`, e);
      }
    }),
  );

  return result;
}

/**
 * 将搜索结果渲染为 HTML
 */
function renderSearchHtml(date, traceId, logsByType) {
  const hasAny =
    logsByType &&
    Object.values(logsByType).some((arr) => Array.isArray(arr) && arr.length > 0);

  let html = '';
  html += '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">';
  html += `<title>日志搜索 - ${escapeHtml(date)} - ${escapeHtml(traceId)}</title>`;
  html +=
    `<style>body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;padding:16px;background:#0f172a;color:#e5e7eb;}h1{font-size:20px;margin-bottom:8px;}h2{font-size:16px;margin:16px 0 8px;}section{background:#020617;border-radius:8px;padding:12px 16px;margin-bottom:12px;border:1px solid #1f2937;}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:12px;}pre{white-space:pre-wrap;word-break:break-all;margin:0;background:#020617;}small{color:#9ca3af;}a{color:#60a5fa;text-decoration:none;}a:hover{text-decoration:underline;}mark{background:#f97316;color:#111827;padding:0 1px;border-radius:2px;}</style>`;
  html += '</head><body>';

  html += '<header>';
  html += '<h1>日志搜索结果</h1>';
  html += `<p><small>日期: ${escapeHtml(date)} &nbsp;|&nbsp; traceId: <code>${escapeHtml(
    traceId,
  )}</code></small></p>`;
  html += '</header>';

  if (!hasAny) {
    html += '<p>未在指定日期的日志文件中找到任何匹配该 traceId 的记录。</p>';
  } else {
    // 先按指定顺序输出
    const alreadyRendered = new Set();

    const renderSection = (type) => {
      const lines = logsByType[type];
      const safeType = escapeHtml(type);
      if (!lines || lines.length === 0) {
        html += `<section><h2>${safeType}（0 条）</h2><p><small>无匹配记录</small></p></section>`;
        alreadyRendered.add(type);
        return;
      }

      html += `<section><h2>${safeType}（${lines.length} 条）</h2>`;
      html += '<pre>';
      const highlightId = escapeHtml(traceId);
      const highlightReg = new RegExp(highlightId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      for (const line of lines) {
        const safeLine = escapeHtml(line).replace(
          highlightReg,
          (m) => `<mark>${m}</mark>`,
        );
        html += `${safeLine}\n`;
      }
      html += '</pre></section>';
      alreadyRendered.add(type);
    };

    LOG_TYPE_ORDER.forEach((type) => {
      // 即使该类型没有匹配记录，也输出空块以保持顺序
      renderSection(type);
    });

    // 其它类型（如果有），按名称排序追加在后面
    Object.keys(logsByType)
      .filter((t) => !alreadyRendered.has(t))
      .sort()
      .forEach((t) => {
        renderSection(t);
      });
  }

  html += '</body></html>';
  return html;
}

/**
 * 处理 /log/search?date=YYYY-MM-DD&traceId=xxx
 */
async function handleSearch(req, res, query) {
  const date = (query.date || '').trim();
  const traceId = (query.traceId || '').trim();

  if (!date) {
    return sendError(res, 400, '缺少 date 参数');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return sendError(res, 400, 'date 格式不正确，应为 YYYY-MM-DD');
  }
  if (!traceId) {
    return sendError(res, 400, '缺少 traceId 参数');
  }

  try {
    const logsByType = await collectLogsByTraceId(date, traceId);
    const html = renderSearchHtml(date, traceId, logsByType);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (e) {
    console.error('搜索日志失败:', e);
    sendError(res, 500, e.message || '搜索日志失败');
  }
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url || '/', true);
  const pathname = parsedUrl.pathname || '/';
  const method = req.method || 'GET';

  if (method !== 'GET') {
    return sendError(res, 405, '仅支持 GET 请求');
  }

  // /log/trade 返回最新 trade.log
  if (pathname === '/log/trade') {
    handleLatestTrade(res);
    return;
  }

  // /log/search?date=YYYY-MM-DD&traceId=xxx
  if (pathname === '/log/search') {
    handleSearch(req, res, parsedUrl.query || {});
    return;
  }

  sendError(res, 404, '未找到对应路由');
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log(`日志服务已启动: http://localhost:${PORT}/`);
  console.log(`日志根目录: ${LOGS_ROOT}`);
});



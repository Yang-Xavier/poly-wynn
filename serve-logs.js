const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// 根目录为当前项目下的 logs 目录
const LOGS_ROOT = path.join(__dirname, 'logs');

// 简单的内容类型映射
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function sendError(res, statusCode, message) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`${statusCode} ${message}\n`);
}

// 获取当天日志目录名，如 2025-12-09
function getTodayDirName() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 实现类似 tail -f 的实时日志输出
function streamRealtimeLog(res, logFilePath, tailBytes = 16 * 1024) {
  fs.stat(logFilePath, (err, stats) => {
    if (err) {
      if (err.code === 'ENOENT') {
        return sendError(res, 404, '日志文件不存在');
      }
      console.error('获取日志文件信息失败:', err);
      return sendError(res, 500, '获取日志文件信息失败');
    }

    let lastSize = stats.size;
    let watcher = null;
    let closed = false;

    // 基础响应头，使用分块传输实现流式输出
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Transfer-Encoding': 'chunked',
      Connection: 'keep-alive',
    });

    // 先输出最后 tailBytes 字节内容
    const start = Math.max(0, stats.size - tailBytes);
    const initialStream = fs.createReadStream(logFilePath, { start });
    initialStream.on('error', (streamErr) => {
      console.error('读取日志文件失败:', streamErr);
      if (!closed) {
        closed = true;
        res.end('读取日志文件失败\n');
      }
    });
    initialStream.on('data', (chunk) => {
      if (!closed) {
        res.write(chunk);
      }
    });

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      if (!res.writableEnded) {
        res.end();
      }
    };

    const startWatch = () => {
      watcher = fs.watch(logFilePath, (eventType) => {
        if (closed) return;
        if (eventType !== 'change') return;

        fs.stat(logFilePath, (statErr, newStats) => {
          if (statErr) {
            console.error('监听日志文件时获取状态失败:', statErr);
            return;
          }

          // 文件被截断，重置位置
          if (newStats.size < lastSize) {
            lastSize = newStats.size;
          }

          if (newStats.size > lastSize) {
            const readStream = fs.createReadStream(logFilePath, {
              start: lastSize,
              end: newStats.size - 1,
            });
            lastSize = newStats.size;

            readStream.on('error', (readErr) => {
              console.error('读取新增日志失败:', readErr);
            });

            readStream.on('data', (chunk) => {
              if (!closed) {
                res.write(chunk);
              }
            });
          }
        });
      });
    };

    initialStream.on('end', () => {
      if (!closed) {
        startWatch();
      }
    });

    res.on('close', cleanup);
    res.on('finish', cleanup);
  });
}

function sendDirectoryListing(res, dirPath, urlPath) {
  fs.readdir(dirPath, { withFileTypes: true }, (err, entries) => {
    if (err) {
      console.error('读取目录失败:', err);
      return sendError(res, 500, '读取目录失败');
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

    const title = `索引 - ${urlPath || '/'}`;
    res.write('<!DOCTYPE html>');
    res.write('<html lang="zh-CN"><head><meta charset="utf-8">');
    res.write(`<title>${title}</title>`);
    res.write(
      '<style>body{font-family:system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;padding:16px;}a{color:#2563eb;text-decoration:none}a:hover{text-decoration:underline}ul{list-style:none;padding-left:0}li{margin:4px 0}</style>',
    );
    res.write('</head><body>');
    res.write(`<h1>${title}</h1>`);

    if (urlPath !== '/') {
      const parent = urlPath.replace(/\/$/, '').split('/').slice(0, -1).join('/') || '/';
      res.write(`<p><a href="${parent}">⬆ 返回上级目录</a></p>`);
    }

    res.write('<ul>');
    entries
      .sort((a, b) => a.name.localeCompare(b.name, 'en'))
      .forEach((entry) => {
        const name = entry.name;
        const isDir = entry.isDirectory();
        const href =
          (urlPath === '/' ? '' : urlPath.replace(/\/$/, '')) + '/' + encodeURIComponent(name) + (isDir ? '/' : '');
        res.write(
          `<li>${isDir ? '📁' : '📄'} <a href="${href}">${name}${isDir ? '/' : ''}</a></li>`,
        );
      });
    res.write('</ul>');
    res.write('</body></html>');
    res.end();
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url || '/');
  let pathname = decodeURIComponent(parsedUrl.pathname || '/');

  // 特殊路由：/logs/real/xxx => 当天目录下 xxx.log 的 tail -f
  if (pathname.startsWith('/logs/real/')) {
    const namePart = pathname.slice('/logs/real/'.length).replace(/\/+$/, '');
    if (!namePart) {
      return sendError(res, 400, '缺少日志文件名');
    }

    const baseName = namePart.endsWith('.log') ? namePart : `${namePart}.log`;
    const todayDir = getTodayDirName();
    const logFilePath = path.join(LOGS_ROOT, todayDir, baseName);

    // 安全检查：必须在 LOGS_ROOT 之下
    const normalized = path.normalize(logFilePath);
    if (!normalized.startsWith(LOGS_ROOT)) {
      return sendError(res, 403, '禁止访问');
    }

    return streamRealtimeLog(res, normalized);
  }

  // 默认静态文件/目录处理
  // 统一去掉多余的 .. 等路径，防止越权访问
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const fsPath = path.join(LOGS_ROOT, safePath);

  if (!fsPath.startsWith(LOGS_ROOT)) {
    return sendError(res, 403, '禁止访问');
  }

  fs.stat(fsPath, (err, stats) => {
    if (err) {
      if (err.code === 'ENOENT') {
        return sendError(res, 404, '未找到');
      }
      console.error('读取文件状态失败:', err);
      return sendError(res, 500, '服务器内部错误');
    }

    if (stats.isDirectory()) {
      // 访问目录时列出目录内容
      const urlPath = pathname.endsWith('/') ? pathname : pathname + '/';
      return sendDirectoryListing(res, fsPath, urlPath);
    }

    // 访问文件时直接返回文件内容
    const contentType = getContentType(fsPath);
    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(fsPath);
    stream.on('error', (streamErr) => {
      console.error('读取文件失败:', streamErr);
      if (!res.headersSent) {
        sendError(res, 500, '读取文件失败');
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  });
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log(`日志静态服务器已启动: http://localhost:${PORT}/`);
  console.log(`根目录: ${LOGS_ROOT}`);
});



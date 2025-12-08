const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, 'logs');

// 计算两天前的 00:00 作为阈值（保留今天和昨天的日志）
function getThresholdDate() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 2);
  return d;
}

function parseDateDirName(name) {
  // 仅匹配形如 2025-12-06 的目录名
  if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) return null;
  const [year, month, day] = name.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

async function removeDir(dirPath) {
  // Node 14+ 支持 fs.rm
  if (fs.rm) {
    await fs.promises.rm(dirPath, { recursive: true, force: true });
  } else {
    // 兼容旧版本 Node
    await fs.promises.rmdir(dirPath, { recursive: true });
  }
}

async function cleanOldLogs() {
  try {
    const threshold = getThresholdDate();

    if (!fs.existsSync(LOGS_DIR)) {
      console.log('[clean-logs] 日志目录不存在，跳过。');
      return;
    }

    const entries = await fs.promises.readdir(LOGS_DIR, { withFileTypes: true });

    const targets = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const dirName = entry.name;
      const dirDate = parseDateDirName(dirName);
      if (!dirDate) continue;

      if (dirDate < threshold) {
        targets.push({
          name: dirName,
          fullPath: path.join(LOGS_DIR, dirName),
        });
      }
    }

    if (targets.length === 0) {
      console.log('[clean-logs] 没有需要删除的旧日志目录。');
      return;
    }

    console.log('[clean-logs] 即将删除以下日志目录（早于两天前）：');
    for (const t of targets) {
      console.log('  -', t.name);
    }

    for (const t of targets) {
      await removeDir(t.fullPath);
    }

    console.log('[clean-logs] 日志清理完成。');
  } catch (err) {
    console.error('[clean-logs] 日志清理出错：', err);
    process.exitCode = 1;
  }
}

cleanOldLogs();



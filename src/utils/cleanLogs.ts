import fs from 'fs';
import path from 'path';

import { getGlobalConfig } from './config';

const config = getGlobalConfig();
const LOGS_DIR = path.isAbsolute(config.logger.logDir)
  ? config.logger.logDir
  : path.join(process.cwd(), config.logger.logDir);

// 计算一天前的 00:00 作为阈值（保留今天和昨天的日志）
function getThresholdDate(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return d;
}

function parseDateDirName(name: string): Date | null {
  // 仅匹配形如 2025-12-06 的目录名
  if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) return null;
  const [year, month, day] = name.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

async function removeDir(dirPath: string): Promise<void> {
  // Node 14+ 支持 fs.rm
  if ((fs as any).rm) {
    await fs.promises.rm(dirPath, { recursive: true, force: true });
  } else {
    // 兼容旧版本 Node
    await fs.promises.rmdir(dirPath, { recursive: true });
  }
}

export async function cleanOldLogs(): Promise<void> {
  try {
    const threshold = getThresholdDate();

    if (!fs.existsSync(LOGS_DIR)) {
      console.log('[clean-logs] 日志目录不存在，跳过。');
      return;
    }

    const entries = await fs.promises.readdir(LOGS_DIR, { withFileTypes: true });

    const targets: Array<{ name: string; fullPath: string }> = [];

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
      console.log('[clean-logs] 没有需要清理的旧日志目录。');
      return;
    }

    console.log('[clean-logs] 即将在以下日期目录中清理旧日志文件（早于一天前，保留 trade.log）：');
    for (const t of targets) {
      console.log('  -', t.name);
    }

    for (const t of targets) {
      const files = await fs.promises.readdir(t.fullPath, { withFileTypes: true });
      for (const f of files) {
        // 只删除普通文件，且文件名不是 trade.log
        if (typeof f.isFile === 'function' ? f.isFile() : (f as any).isFile) {
          if (f.name === 'trade.log') continue;
          const fullFilePath = path.join(t.fullPath, f.name);
          try {
            await fs.promises.unlink(fullFilePath);
          } catch (e) {
            console.error('[clean-logs] 删除文件失败：', fullFilePath, e);
          }
        }
      }
    }

    console.log('[clean-logs] 日志文件清理完成（trade.log 已保留）。');
  } catch (err) {
    console.error('[clean-logs] 日志清理出错：', err);
    process.exitCode = 1;
  }
}





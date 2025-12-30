/**
 * 日期工具函数
 */

/**
 * 获取今天的日期字符串 (yyyy-mm-dd)
 */
export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 验证日期字符串格式 (yyyy-mm-dd)
 */
export function isValidDateString(dateStr: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) {
    return false;
  }
  const date = new Date(dateStr);
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * 从日志时间戳中提取日期 (yyyy-mm-dd)
 * 输入格式: 2025-12-30 10:57:04.519 北京时间
 */
export function extractDateFromLogTimestamp(timestamp: string): string | null {
  const match = timestamp.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}


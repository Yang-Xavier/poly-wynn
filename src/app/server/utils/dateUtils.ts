/**
 * 日期工具函数
 */

/**
 * 获取今天的日期字符串 (yyyy-mm-dd) - 使用北京时间
 */
export function getTodayDateString(): string {
  const now = new Date();
  
  // 获取当前时区偏移（分钟）
  // 负数表示比 UTC 快（如 CST 是 -480，表示 UTC+8）
  // 正数表示比 UTC 慢（如 EST 是 300，表示 UTC-5）
  const timezoneOffset = now.getTimezoneOffset();
  const currentOffsetMinutes = -timezoneOffset; // 当前时区相对于 UTC 的偏移（分钟）
  const beijingOffsetMinutes = 8 * 60; // 北京时间是 UTC+8 = 480 分钟
  
  // 如果当前时区已经是北京时间（UTC+8），直接使用本地时间
  if (currentOffsetMinutes === beijingOffsetMinutes) {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  
  // 否则，需要转换为北京时间
  const additionalMinutes = beijingOffsetMinutes - currentOffsetMinutes;
  const beijingTimestamp = now.getTime() + additionalMinutes * 60 * 1000;
  const beijingDate = new Date(beijingTimestamp);
  
  // 使用 UTC 方法获取年月日（因为 beijingTimestamp 已经是 UTC+8 的时间戳）
  const year = beijingDate.getUTCFullYear();
  const month = String(beijingDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(beijingDate.getUTCDate()).padStart(2, "0");
  
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


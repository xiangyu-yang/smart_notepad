export function formatTime(ts: number): string {
  if (!ts) return '';
  const now = Date.now();
  const diff = now - ts;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) {
    return '刚刚';
  }

  if (diff < hour) {
    const mins = Math.floor(diff / minute);
    return `${mins}分钟前`;
  }

  if (diff < day) {
    const hours = Math.floor(diff / hour);
    return `${hours}小时前`;
  }

  if (diff < 7 * day) {
    const days = Math.floor(diff / day);
    return `${days}天前`;
  }

  const date = new Date(ts);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const thisYear = new Date().getFullYear();
  if (date.getFullYear() === thisYear) {
    return `${mm}-${dd} ${hh}:${mi}`;
  }
  return `${date.getFullYear()}-${mm}-${dd} ${hh}:${mi}`;
}

/**
 * Format a timestamp as a short absolute date (no relative).
 * Used for card footers where both 创建/修改 sit next to each other.
 */
export function formatShortDateTime(ts: number): string {
  if (!ts) return '';
  const date = new Date(ts);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  if (sameDay) return `今天 ${hh}:${mi}`;
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sameYest =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (sameYest) return `昨天 ${hh}:${mi}`;
  if (date.getFullYear() === now.getFullYear()) return `${mm}-${dd} ${hh}:${mi}`;
  return `${date.getFullYear()}-${mm}-${dd}`;
}

import dayjs from 'dayjs';

export const LOCAL_DATETIME_PATTERN = 'YYYY-MM-DD HH:mm:ss';

export function nowIso() {
  return dayjs().toISOString();
}

export function nowLocalDateTime() {
  return dayjs().format(LOCAL_DATETIME_PATTERN);
}

export function toLocalDateTime(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;

  if (typeof value === 'number' && Number.isFinite(value)) {
    const absText = String(Math.trunc(Math.abs(value)));
    if (absText.length >= 10) {
      const timestampMs = absText.length === 10 ? value * 1000 : value;
      return dayjs(timestampMs).format(LOCAL_DATETIME_PATTERN);
    }
  }

  const text = String(value || '').trim();
  if (!text) return fallback;

  if (/^\d{10,13}$/.test(text)) {
    const num = Number(text);
    const timestampMs = text.length === 10 ? num * 1000 : num;
    if (Number.isFinite(timestampMs)) {
      return dayjs(timestampMs).format(LOCAL_DATETIME_PATTERN);
    }
  }

  const parsed = dayjs(value);
  if (parsed.isValid()) {
    return parsed.format(LOCAL_DATETIME_PATTERN);
  }

  const minuteMatch = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/);
  if (minuteMatch) {
    return `${minuteMatch[1]} ${minuteMatch[2]}:00`;
  }

  const secondMatch = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  if (secondMatch) {
    return `${secondMatch[1]} ${secondMatch[2]}`;
  }

  return fallback ?? text;
}

export function formatDate(date, pattern = 'YYYY-MM-DD') {
  return dayjs(date).format(pattern);
}

export function startOfDay(date) {
  return dayjs(date).startOf('day').toDate();
}

export function parseDateInput(value, fallback) {
  if (!value) return fallback;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.toDate() : fallback;
}

export function withinDateRange(value, start, end) {
  const current = dayjs(value);
  return current.isAfter(dayjs(start).subtract(1, 'day')) && current.isBefore(dayjs(end).add(1, 'day'));
}

export function daysAgo(days) {
  return dayjs().subtract(days, 'day').toDate();
}

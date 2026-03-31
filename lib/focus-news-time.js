const SOURCE_TIME_ZONE = 'Asia/Shanghai';
const SOURCE_OFFSET = '+08:00';
const SOURCE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SOURCE_DATE_DIGITS_RE = /^(\d{4})(\d{2})(\d{2})$/;
const SOURCE_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
const SOURCE_DATETIME_DIGITS_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;
const SOURCE_TIME_ONLY_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const ABSOLUTE_TIME_HINT_RE = /(Z|[+-]\d{2}:\d{2}|GMT|UTC)$/i;

const sourceDateFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: SOURCE_TIME_ZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function pad2(value) {
  return String(value).padStart(2, '0');
}

function isValidDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    !Number.isNaN(date.getTime())
    && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
  );
}

function toSourceOffsetDateTime({ year, month, day, hour = '00', minute = '00', second = '00' }) {
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${SOURCE_OFFSET}`;
}

function formatTimestampToSourceDateTime(timestampMs) {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return null;

  const parts = {};
  sourceDateFormatter.formatToParts(date).forEach((item) => {
    if (item.type !== 'literal') parts[item.type] = item.value;
  });

  if (!parts.year || !parts.month || !parts.day || !parts.hour || !parts.minute || !parts.second) {
    return null;
  }

  return toSourceOffsetDateTime({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  });
}

function normalizeDayText(input = '') {
  const text = String(input || '').trim();
  if (!text) return '';

  const plain = text.match(SOURCE_DATE_RE);
  if (plain) {
    const year = Number(plain[1]);
    const month = Number(plain[2]);
    const day = Number(plain[3]);
    return isValidDateParts(year, month, day) ? `${plain[1]}-${plain[2]}-${plain[3]}` : '';
  }

  const digits = text.match(SOURCE_DATE_DIGITS_RE);
  if (digits) {
    const year = Number(digits[1]);
    const month = Number(digits[2]);
    const day = Number(digits[3]);
    if (!isValidDateParts(year, month, day)) return '';
    return `${digits[1]}-${digits[2]}-${digits[3]}`;
  }

  return '';
}

function normalizeNaiveSourceDateTime(text = '', fallbackDay = '') {
  const digits14 = String(text || '').match(SOURCE_DATETIME_DIGITS_RE);
  if (digits14) {
    const year = Number(digits14[1]);
    const month = Number(digits14[2]);
    const day = Number(digits14[3]);
    if (!isValidDateParts(year, month, day)) return null;
    return toSourceOffsetDateTime({
      year: digits14[1],
      month: digits14[2],
      day: digits14[3],
      hour: digits14[4],
      minute: digits14[5],
      second: digits14[6],
    });
  }

  const plainDateTime = String(text || '').match(SOURCE_DATETIME_RE);
  if (plainDateTime) {
    const year = Number(plainDateTime[1]);
    const month = Number(plainDateTime[2]);
    const day = Number(plainDateTime[3]);
    if (!isValidDateParts(year, month, day)) return null;
    return toSourceOffsetDateTime({
      year: plainDateTime[1],
      month: plainDateTime[2],
      day: plainDateTime[3],
      hour: plainDateTime[4],
      minute: plainDateTime[5],
      second: plainDateTime[6] || '00',
    });
  }

  const dayText = normalizeDayText(text);
  if (dayText) {
    return `${dayText}T00:00:00${SOURCE_OFFSET}`;
  }

  const timeOnly = String(text || '').match(SOURCE_TIME_ONLY_RE);
  if (timeOnly) {
    const sourceDay = normalizeDayText(fallbackDay);
    if (!sourceDay) return null;
    return `${sourceDay}T${timeOnly[1]}:${timeOnly[2]}:${timeOnly[3] || '00'}${SOURCE_OFFSET}`;
  }

  return null;
}

export function normalizeSourceDateTime(value, { fallbackDay = '' } = {}) {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    const absText = String(Math.trunc(Math.abs(value)));
    if (absText.length >= 10) {
      const timestampMs = absText.length === 10 ? value * 1000 : value;
      return formatTimestampToSourceDateTime(timestampMs);
    }
  }

  const text = String(value || '').trim();
  if (!text) return null;

  if (/^\d{10,13}$/.test(text)) {
    const num = Number(text);
    if (!Number.isFinite(num)) return null;
    const timestampMs = text.length === 10 ? num * 1000 : num;
    return formatTimestampToSourceDateTime(timestampMs);
  }

  const naive = normalizeNaiveSourceDateTime(text, fallbackDay);
  if (naive) return naive;

  if (ABSOLUTE_TIME_HINT_RE.test(text)) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : formatTimestampToSourceDateTime(parsed.getTime());
  }

  return null;
}

export function toSourceTimestamp(value) {
  const normalized = normalizeSourceDateTime(value);
  if (!normalized) return 0;
  const timestampMs = new Date(normalized).getTime();
  return Number.isFinite(timestampMs) ? timestampMs : 0;
}

export function sourceDayText(value) {
  const normalized = normalizeSourceDateTime(value);
  if (!normalized) return '';
  return normalized.slice(0, 10);
}

export function formatSourceDateTime(value, { fallback = '--', withSeconds = true } = {}) {
  const normalized = normalizeSourceDateTime(value);
  if (!normalized) return fallback;

  const datePart = normalized.slice(0, 10);
  const timePart = normalized.slice(11, 19);
  if (!datePart || !timePart) return fallback;
  return withSeconds ? `${datePart} ${timePart}` : `${datePart} ${timePart.slice(0, 5)}`;
}

export function formatSourceRelativeTime(value, nowTimestamp = Date.now()) {
  const timestampMs = toSourceTimestamp(value);
  if (!timestampMs) return '--';

  const delta = Math.max(0, nowTimestamp - timestampMs);
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;

  return formatSourceDateTime(value, { withSeconds: false });
}

export function normalizeSourceDayText(value, fallback = '') {
  return normalizeDayText(value) || normalizeDayText(fallback);
}

export { SOURCE_OFFSET, SOURCE_TIME_ZONE };

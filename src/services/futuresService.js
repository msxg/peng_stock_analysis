import { HttpError } from '../utils/httpError.js';
import { futuresRepository } from '../repositories/futuresRepository.js';
import { futuresBasicsRepository } from '../repositories/futuresBasicsRepository.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { nowLocalDateTime, toLocalDateTime } from '../utils/date.js';
import { getOfficialFuturesTradingHours } from '../utils/tradingHours.js';

const FUTURES_QUOTE_TOKEN = '1101ffec61617c99be287c1bec3085ff';
const FUTURES_HISTORY_UT = 'fa5fd1943c7b386f172d6893dbfba10b';
const FUTURES_PRESET_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const execFileAsync = promisify(execFile);

const FUTURES_TIMEFRAME_MAP = {
  '30s': { code: null, label: '30秒' },
  '1m': { code: '1', label: '1分钟' },
  '5m': { code: '5', label: '5分钟' },
  '15m': { code: '15', label: '15分钟' },
  '30m': { code: '30', label: '30分钟' },
  '60m': { code: '60', label: '60分钟' },
  '1d': { code: '101', label: '日线' },
  '1w': { code: '102', label: '周线' },
  '1M': { code: '103', label: '月线' },
};
const FUTURES_LONG_KLINE_KEYS = new Set(['1d', '1w', '1M']);
const FUTURES_INTRADAY_INTERVAL_MINUTES = {
  '30s': 0.5,
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '60m': 60,
};
const FUTURES_STORED_TIMEFRAME_INTERVAL_MINUTES = {
  ...FUTURES_INTRADAY_INTERVAL_MINUTES,
  '1d': 1440,
  '1w': 10080,
  '1M': 43200,
};
const FUTURES_MONITOR_DEFAULT_LIMIT_MAP = {
  '1m': 1800,
};
const FUTURES_INTRADAY_STORE_MAX_LIMIT = 4000;
const LOCAL_INTRADAY_DATA_SOURCE = 'local.sqlite.intraday';
const LOCAL_DERIVED_INTRADAY_SOURCE = 'local.derived.from.1m';
const LONG_KLINE_BACKGROUND_SYNC_MIN_INTERVAL_MS = 60 * 1000;
const longKlineBackgroundSyncState = new Map();

const FUTURES_ALIAS_CODE_MAP = {
  GC: '101.GC00Y',
  SI: '101.SI00Y',
  HG: '101.HG00Y',
  CL: '102.CL00Y',
  NG: '102.NG00Y',
  RB: '102.RB00Y',
  HO: '102.HO00Y',
  B: '112.B00Y',
  GOLD: '101.GC00Y',
  SILVER: '101.SI00Y',
};

const FUTURES_ALIAS_NAME_MAP = {
  黄金: '101.GC00Y',
  白银: '101.SI00Y',
  铜: '101.HG00Y',
  原油: '102.CL00Y',
  布伦特原油: '112.B00Y',
  天然气: '102.NG00Y',
};

const FUTURES_TENCENT_QUOTE_MAP = {
  '101.GC00Y': 'hf_GC',
  '101.SI00Y': 'hf_SI',
  '101.HG00Y': 'hf_HG',
  '102.CL00Y': 'hf_CL',
  '102.NG00Y': 'hf_NG',
  '112.B00Y': 'hf_OIL',
};

const FUTURES_PRESET_FALLBACK = [
  { exchange: 'COMEX', name: '黄金主连', quoteCode: '101.GC00Y', source: 'local.fallback' },
  { exchange: 'COMEX', name: '白银主连', quoteCode: '101.SI00Y', source: 'local.fallback' },
  { exchange: 'COMEX', name: '铜主连', quoteCode: '101.HG00Y', source: 'local.fallback' },
  { exchange: 'NYMEX', name: '原油主连', quoteCode: '102.CL00Y', source: 'local.fallback' },
  { exchange: 'NYMEX', name: '天然气主连', quoteCode: '102.NG00Y', source: 'local.fallback' },
  { exchange: 'IPE', name: '布伦特原油主连', quoteCode: '112.B00Y', source: 'local.fallback' },
  { exchange: '上期所(示例)', name: '沪金(自动匹配当前合约)', quoteCode: 'au', source: 'local.fallback' },
  { exchange: '上期所(示例)', name: '沪银(自动匹配当前合约)', quoteCode: 'ag', source: 'local.fallback' },
  { exchange: '上期能源(示例)', name: '原油(自动匹配当前合约)', quoteCode: 'sc', source: 'local.fallback' },
];

const futuresPresetCache = {
  updatedAt: 0,
  items: [],
};

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function decodeGbkPayload(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  try {
    return new TextDecoder('gbk').decode(source);
  } catch {
    return source.toString('utf8');
  }
}

function wasMonitorErrorLogged(error) {
  return Boolean(error && typeof error === 'object' && error.__monitorLogged === true);
}

function markMonitorErrorLogged(error) {
  if (!error || typeof error !== 'object') return;
  try {
    Object.defineProperty(error, '__monitorLogged', {
      value: true,
      configurable: true,
      enumerable: false,
      writable: true,
    });
  } catch {
    // eslint-disable-next-line no-param-reassign
    error.__monitorLogged = true;
  }
}

function logFuturesMonitorIssue({
  level = 'error',
  stage = 'unknown',
  symbol = null,
  timeframe = '',
  limit = null,
  error = null,
  extra = null,
} = {}) {
  if (wasMonitorErrorLogged(error)) return;

  const logger = level === 'warn' ? console.warn : console.error;
  const causeText = buildErrorCauseText(error);
  const errorDebug = (
    error && typeof error === 'object' && Object.prototype.hasOwnProperty.call(error, '__debug')
      ? error.__debug
      : undefined
  );
  const remoteUrl = String(errorDebug?.url || extra?.url || '');
  logger('[futures-monitor]', {
    at: nowLocalDateTime(),
    level,
    stage,
    quoteCode: symbol?.quoteCode || null,
    staticCode: symbol?.staticCode || null,
    secid: symbol?.secid || null,
    timeframe: timeframe || null,
    limit: Number.isFinite(Number(limit)) ? Number(limit) : null,
    errorName: error?.name || null,
    errorCode: error?.code || null,
    errorStatus: error?.status || null,
    errorMessage: error?.message || (error ? String(error) : null),
    errorCause: causeText || null,
    errorDebug: errorDebug || undefined,
    remoteUrl: remoteUrl || undefined,
    extra: extra || undefined,
  });

  const shouldPrintTrace = Boolean(
    error?.stack
    && (level === 'error' || /failed|error/i.test(String(stage || ''))),
  );
  if (shouldPrintTrace) {
    logger('[futures-monitor][trace]', error.stack);
  }

  markMonitorErrorLogged(error);
}

function attachDebugErrorMeta(error, { cause = null, debug = null } = {}) {
  if (!error || typeof error !== 'object') return error;

  if (cause && typeof cause === 'object') {
    try {
      Object.defineProperty(error, 'cause', {
        value: cause,
        configurable: true,
        enumerable: false,
        writable: true,
      });
    } catch {
      // eslint-disable-next-line no-param-reassign
      error.cause = cause;
    }
  }

  if (debug !== undefined && debug !== null) {
    try {
      Object.defineProperty(error, '__debug', {
        value: debug,
        configurable: true,
        enumerable: false,
        writable: true,
      });
    } catch {
      // eslint-disable-next-line no-param-reassign
      error.__debug = debug;
    }
  }

  return error;
}

function compactText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildErrorCauseText(error, maxDepth = 4) {
  const parts = [];
  const seen = new Set();
  let current = error;
  let depth = 0;

  while (current && typeof current === 'object' && depth < maxDepth && !seen.has(current)) {
    seen.add(current);
    const item = [];
    if (current.name) item.push(`name=${compactText(current.name)}`);
    if (current.code) item.push(`code=${compactText(current.code)}`);
    if (current.errno !== undefined && current.errno !== null) item.push(`errno=${current.errno}`);
    if (current.syscall) item.push(`syscall=${compactText(current.syscall)}`);
    if (current.hostname) item.push(`hostname=${compactText(current.hostname)}`);
    if (current.address) item.push(`address=${compactText(current.address)}`);
    if (current.port !== undefined && current.port !== null) item.push(`port=${current.port}`);
    if (current.message) item.push(`message=${compactText(current.message)}`);
    if (item.length) {
      parts.push(`[${depth}] ${item.join(', ')}`);
    }
    current = current.cause;
    depth += 1;
  }

  return compactText(parts.join(' <= '));
}

function briefErrorMessage(error, fallback = '未知错误') {
  const stderr = String(error?.stderr || '').trim();
  const message = String(error?.message || '').trim();
  const source = stderr || message || fallback;
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] || fallback;
}

function normalizeQuoteChangeMetrics({ price, prevClose, change, changePct }) {
  let normalizedChange = toNum(change);
  let normalizedPct = toNum(changePct);
  const normalizedPrice = toNum(price);
  const normalizedPrevClose = toNum(prevClose);
  const derivedPrevClose = (
    normalizedPrice != null
    && normalizedChange != null
  ) ? (normalizedPrice - normalizedChange) : null;

  if (
    normalizedChange == null
    && normalizedPrice != null
    && normalizedPrevClose != null
    && normalizedPrevClose !== 0
  ) {
    normalizedChange = normalizedPrice - normalizedPrevClose;
  }

  if (
    normalizedChange == null
    && normalizedPct != null
    && normalizedPrevClose != null
    && normalizedPrevClose !== 0
  ) {
    normalizedChange = normalizedPrevClose * (normalizedPct / 100);
  }

  if (
    normalizedChange != null
    && derivedPrevClose != null
    && derivedPrevClose !== 0
  ) {
    normalizedPct = (normalizedChange / derivedPrevClose) * 100;
  } else
  if (
    normalizedChange != null
    && normalizedPrevClose != null
    && normalizedPrevClose !== 0
  ) {
    normalizedPct = (normalizedChange / normalizedPrevClose) * 100;
  }

  if (normalizedChange != null && normalizedPct != null && normalizedChange !== 0 && normalizedPct !== 0) {
    const sign = normalizedChange > 0 ? 1 : -1;
    normalizedPct = Math.abs(normalizedPct) * sign;
  }

  return {
    change: normalizedChange,
    changePct: normalizedPct,
  };
}

function toTencentFuturesCode(symbol = {}) {
  const quoteCode = String(symbol?.quoteCode || '').trim().toUpperCase();
  return FUTURES_TENCENT_QUOTE_MAP[quoteCode] || '';
}

function formatTencentFuturesTradeTime(dateValue, timeValue) {
  const dateText = String(dateValue || '').trim();
  const timeText = String(timeValue || '').trim();
  if (!dateText && !timeText) return null;

  if (/^\d{2}:\d{2}:\d{2}$/.test(timeText) && /^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    return `${dateText} ${timeText}`;
  }

  return toLocalDateTime(`${dateText} ${timeText}`.trim(), null);
}

function parseKlineRow(line) {
  const parts = String(line || '').split(',');
  if (parts.length < 6) return null;
  const date = parts[0];
  const open = toNum(parts[1]);
  const close = toNum(parts[2]);
  const high = toNum(parts[3]);
  const low = toNum(parts[4]);
  const volume = toNum(parts[5]);
  const amount = toNum(parts[6]);

  if (!date || close == null) return null;

  return {
    date,
    open,
    high,
    low,
    close,
    volume: volume ?? 0,
    amount: amount ?? 0,
  };
}

function parseCandleDateToTs(dateText) {
  const text = String(dateText || '').trim();
  if (!text) return null;

  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] || '0');
  const minute = Number(match[5] || '0');
  const second = Number(match[6] || '0');

  const tsMs = new Date(year, month - 1, day, hour, minute, second).getTime();
  if (!Number.isFinite(tsMs)) return null;
  return Math.floor(tsMs / 1000);
}

function formatLocalDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function startOfIsoWeek(date = new Date()) {
  const dayStart = startOfDay(date);
  const weekday = dayStart.getDay(); // 0=Sun, 1=Mon, ...
  const moveBack = weekday === 0 ? 6 : weekday - 1;
  return new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() - moveBack, 0, 0, 0, 0);
}

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function currentPeriodStartDay(timeframe = '1d', now = new Date()) {
  const tf = String(timeframe || '');
  if (tf === '1w') return formatLocalDate(startOfIsoWeek(now));
  if (tf === '1M') return formatLocalDate(startOfMonth(now));
  return formatLocalDate(startOfDay(now));
}

function periodKeyByDateText(dateText, timeframe = '1d') {
  const ts = parseCandleDateToTs(dateText);
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts * 1000);
  const tf = String(timeframe || '');
  if (tf === '1w') {
    return formatLocalDate(startOfIsoWeek(d));
  }
  if (tf === '1M') {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  return formatLocalDate(startOfDay(d));
}

function periodBucketTs(rawTs, timeframe = '1d') {
  const d = new Date(rawTs * 1000);
  const tf = String(timeframe || '');
  if (tf === '1w') {
    return Math.floor(startOfIsoWeek(d).getTime() / 1000);
  }
  if (tf === '1M') {
    return Math.floor(startOfMonth(d).getTime() / 1000);
  }
  return Math.floor(startOfDay(d).getTime() / 1000);
}

function toDateString(ts, intervalMinutes) {
  const date = new Date(ts * 1000);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');

  if (intervalMinutes >= 1440) {
    return `${y}-${m}-${d}`;
  }
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function fillIntradayCandleGaps(candles = [], timeframe = '1m', { latestDayOnly = false } = {}) {
  const intervalMinutes = FUTURES_INTRADAY_INTERVAL_MINUTES[timeframe];
  if (!intervalMinutes || !Array.isArray(candles) || !candles.length) {
    return Array.isArray(candles) ? candles : [];
  }

  const bucketSpan = intervalMinutes * 60;
  const parsed = candles
    .map((item, index) => {
      const ts = parseCandleDateToTs(item?.date);
      if (!Number.isFinite(ts)) return null;
      return { ...item, _ts: ts, _index: index };
    })
    .filter(Boolean)
    .sort((a, b) => (a._ts - b._ts) || (a._index - b._index));

  if (!parsed.length) return Array.isArray(candles) ? candles : [];

  let scope = parsed;
  if (latestDayOnly) {
    const latestDay = String(parsed[parsed.length - 1]?.date || '').slice(0, 10);
    const latestDayItems = parsed.filter((item) => String(item?.date || '').slice(0, 10) === latestDay);
    if (latestDayItems.length) {
      scope = latestDayItems;
    }
  }
  if (!scope.length) return [];

  const alignedMap = new Map();
  scope.forEach((item) => {
    const alignedTs = Math.floor(item._ts / bucketSpan) * bucketSpan;
    alignedMap.set(alignedTs, {
      ...item,
      _ts: alignedTs,
      date: toDateString(alignedTs, intervalMinutes),
    });
  });
  const rows = Array.from(alignedMap.values()).sort((a, b) => a._ts - b._ts);
  if (!rows.length) return [];

  const first = rows[0];
  const last = rows[rows.length - 1];
  const byTs = new Map(rows.map((item) => [item._ts, item]));
  const continuous = [];
  let prevClose = toNum(first.close);
  if (prevClose == null) prevClose = toNum(first.open);
  if (prevClose == null) prevClose = 0;

  for (let ts = first._ts; ts <= last._ts; ts += bucketSpan) {
    const hit = byTs.get(ts);
    if (hit) {
      continuous.push(hit);
      const close = toNum(hit.close);
      if (close != null) {
        prevClose = close;
      }
      continue;
    }

    continuous.push({
      date: toDateString(ts, intervalMinutes),
      open: prevClose,
      high: prevClose,
      low: prevClose,
      close: prevClose,
      volume: 0,
      amount: 0,
      _ts: ts,
    });
  }

  return continuous.map((item) => ({
    date: item.date,
    open: toNum(item.open),
    high: toNum(item.high),
    low: toNum(item.low),
    close: toNum(item.close),
    volume: toNum(item.volume) ?? 0,
    amount: toNum(item.amount) ?? 0,
  }));
}

function normalizeIntradayLimit(limit, timeframe = '1m') {
  const base = FUTURES_MONITOR_DEFAULT_LIMIT_MAP[timeframe] || 120;
  return Math.min(Math.max(Number(limit) || base, 20), FUTURES_INTRADAY_STORE_MAX_LIMIT);
}

function alignIntradayCandle(item, timeframe = '1m', index = 0) {
  const tf = String(timeframe || '');
  const intervalMinutes = FUTURES_STORED_TIMEFRAME_INTERVAL_MINUTES[tf];
  if (!intervalMinutes) return null;

  const rawTs = parseCandleDateToTs(item?.date);
  if (!Number.isFinite(rawTs)) return null;
  const bucketSpan = Math.max(1, Math.round(intervalMinutes * 60));
  const bucketTs = FUTURES_LONG_KLINE_KEYS.has(tf)
    ? periodBucketTs(rawTs, tf)
    : Math.floor(rawTs / bucketSpan) * bucketSpan;
  const longDateText = String(item?.date || '').trim().slice(0, 10);

  const open = toNum(item?.open);
  const high = toNum(item?.high);
  const low = toNum(item?.low);
  const close = toNum(item?.close);
  if (close == null && open == null && high == null && low == null) return null;

  return {
    _index: index,
    _ts: bucketTs,
    date: FUTURES_LONG_KLINE_KEYS.has(tf)
      ? (longDateText || toDateString(rawTs, intervalMinutes))
      : toDateString(bucketTs, intervalMinutes),
    open,
    high,
    low,
    close,
    volume: toNum(item?.volume) ?? 0,
    amount: toNum(item?.amount) ?? 0,
  };
}

function candlesToIntradayStoreBars(candles = [], timeframe = '1m', source = null) {
  if (!Array.isArray(candles) || !candles.length) return [];
  const aligned = candles
    .map((item, index) => alignIntradayCandle(item, timeframe, index))
    .filter(Boolean)
    .sort((a, b) => (a._ts - b._ts) || (a._index - b._index));
  if (!aligned.length) return [];

  const deduped = new Map();
  aligned.forEach((item) => {
    deduped.set(item._ts, item);
  });

  return Array.from(deduped.values())
    .sort((a, b) => a._ts - b._ts)
    .map((item) => ({
      tradeDay: String(item.date || '').slice(0, 10),
      bucketTs: item._ts,
      date: item.date,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume ?? 0,
      amount: item.amount ?? 0,
      source: source || null,
    }));
}

function intradayBarsToCandles(rows = []) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.map((item) => ({
    date: item.date,
    open: toNum(item.open),
    high: toNum(item.high),
    low: toNum(item.low),
    close: toNum(item.close),
    volume: toNum(item.volume) ?? 0,
    amount: toNum(item.amount) ?? 0,
  }));
}

function mergeIntradayCandles(baseCandles = [], incomingCandles = [], timeframe = '1m') {
  const base = Array.isArray(baseCandles) ? baseCandles : [];
  const incoming = Array.isArray(incomingCandles) ? incomingCandles : [];
  if (!base.length) return incoming;
  if (!incoming.length) return base;

  const merged = new Map();
  base.forEach((item, index) => {
    const aligned = alignIntradayCandle(item, timeframe, index);
    if (!aligned) return;
    merged.set(aligned._ts, aligned);
  });
  incoming.forEach((item, index) => {
    const aligned = alignIntradayCandle(item, timeframe, index + 1000000);
    if (!aligned) return;
    merged.set(aligned._ts, aligned);
  });

  return Array.from(merged.values())
    .sort((a, b) => a._ts - b._ts)
    .map((item) => ({
      date: item.date,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume ?? 0,
      amount: item.amount ?? 0,
    }));
}

function latestTradeDayFromCandles(candles = []) {
  if (!Array.isArray(candles) || !candles.length) return null;
  const latest = String(candles[candles.length - 1]?.date || '').slice(0, 10);
  return latest || null;
}

function loadIntradayCandlesFromStore({ quoteCode, timeframe = '1m', tradeDay, limit = 1800 } = {}) {
  const day = tradeDay || futuresRepository.getLatestIntradayTradeDay({ quoteCode, timeframe });
  if (!day) return [];
  const rows = futuresRepository.listIntradayBars({
    quoteCode,
    timeframe,
    tradeDay: day,
    limit: normalizeIntradayLimit(limit, timeframe),
  });
  return intradayBarsToCandles(rows);
}

function loadLongCandlesFromStore({ quoteCode, timeframe = '1d', limit = 120 } = {}) {
  const tf = String(timeframe || '');
  if (!FUTURES_LONG_KLINE_KEYS.has(tf)) return [];
  const normalizedLimit = Math.min(Math.max(Number(limit) || 120, 20), FUTURES_INTRADAY_STORE_MAX_LIMIT);
  const rows = futuresRepository.listIntradayBars({
    quoteCode,
    timeframe: tf,
    limit: normalizedLimit,
  });
  return intradayBarsToCandles(rows);
}

function isLongCacheComplete(candles = [], timeframe = '1d', limit = 120) {
  const tf = String(timeframe || '');
  if (!FUTURES_LONG_KLINE_KEYS.has(tf)) return true;
  if (!Array.isArray(candles) || !candles.length) return false;
  const currentKey = periodKeyByDateText(formatLocalDate(new Date()), tf);
  if (!currentKey) return false;
  const hasCurrentPeriod = candles.some((item) => periodKeyByDateText(item?.date, tf) === currentKey);
  if (!hasCurrentPeriod) return false;

  const normalizedLimit = Math.max(Number(limit) || 120, 20);
  const minHistoryByTf = tf === '1d' ? 20 : (tf === '1w' ? 12 : 6);
  const historyFloor = Math.min(minHistoryByTf, normalizedLimit);
  return candles.length >= historyFloor;
}

function buildCurrentLongCandleFromMinuteStore({ quoteCode, timeframe = '1d', now = new Date() } = {}) {
  const tf = String(timeframe || '');
  if (!FUTURES_LONG_KLINE_KEYS.has(tf)) return null;

  const startDay = currentPeriodStartDay(tf, now);
  const endDay = formatLocalDate(now);
  const minuteRows = futuresRepository.listIntradayBarsByRange({
    quoteCode,
    timeframe: '1m',
    startDay,
    endDay,
    limit: 50000,
  });
  if (!minuteRows.length) return null;

  const key = periodKeyByDateText(endDay, tf);
  const scoped = minuteRows
    .map((item) => ({
      date: item.date,
      open: toNum(item.open),
      high: toNum(item.high),
      low: toNum(item.low),
      close: toNum(item.close),
      volume: toNum(item.volume) ?? 0,
      amount: toNum(item.amount) ?? 0,
      ts: parseCandleDateToTs(item.date),
    }))
    .filter((item) => Number.isFinite(item.ts) && periodKeyByDateText(item.date, tf) === key)
    .sort((a, b) => a.ts - b.ts);
  if (!scoped.length) return null;

  const first = scoped.find((item) => item.open != null || item.close != null);
  const last = [...scoped].reverse().find((item) => item.close != null || item.open != null);
  if (!first || !last) return null;

  const open = first.open != null ? first.open : first.close;
  const close = last.close != null ? last.close : last.open;
  if (open == null || close == null) return null;

  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  let volume = 0;
  let amount = 0;
  scoped.forEach((item) => {
    const candidateHigh = item.high != null ? item.high : item.close;
    const candidateLow = item.low != null ? item.low : item.close;
    if (candidateHigh != null) high = Math.max(high, candidateHigh);
    if (candidateLow != null) low = Math.min(low, candidateLow);
    volume += item.volume || 0;
    amount += item.amount || 0;
  });
  if (!Number.isFinite(high)) high = Math.max(open, close);
  if (!Number.isFinite(low)) low = Math.min(open, close);

  return {
    // Keep date on "today" so UI axis remains intuitive for current incomplete period.
    date: endDay,
    open,
    high,
    low,
    close,
    volume,
    amount,
  };
}

function triggerLongKlineBackgroundSync({ normalized, timeframe = '1d', limit = 120 } = {}) {
  const tf = String(timeframe || '');
  if (!normalized?.quoteCode || !FUTURES_LONG_KLINE_KEYS.has(tf)) return;
  const key = `${normalized.quoteCode}|${tf}`;
  const now = Date.now();
  const state = longKlineBackgroundSyncState.get(key) || { running: false, lastAt: 0 };
  if (state.running) return;
  if (now - Number(state.lastAt || 0) < LONG_KLINE_BACKGROUND_SYNC_MIN_INTERVAL_MS) return;

  longKlineBackgroundSyncState.set(key, { running: true, lastAt: now });
  Promise.resolve()
    .then(async () => {
      const candles = await fetchKline(normalized, { timeframe: tf, limit });
      mergeAndPersistLongCandles({
        quoteCode: normalized.quoteCode,
        timeframe: tf,
        limit,
        candles,
        source: 'eastmoney.push2his',
      });
      const derived = buildCurrentLongCandleFromMinuteStore({
        quoteCode: normalized.quoteCode,
        timeframe: tf,
      });
      if (derived) {
        mergeAndPersistLongCandles({
          quoteCode: normalized.quoteCode,
          timeframe: tf,
          limit,
          candles: [derived],
          source: LOCAL_DERIVED_INTRADAY_SOURCE,
        });
      }
    })
    .catch(() => {})
    .finally(() => {
      longKlineBackgroundSyncState.set(key, { running: false, lastAt: Date.now() });
    });
}

function mergeAndPersistIntradayCandles({
  quoteCode,
  timeframe = '1m',
  limit = 1800,
  candles = [],
  source = null,
} = {}) {
  const normalizedLimit = normalizeIntradayLimit(limit, timeframe);
  const storeBars = candlesToIntradayStoreBars(candles, timeframe, source);
  if (storeBars.length) {
    futuresRepository.upsertIntradayBars({
      quoteCode,
      timeframe,
      bars: storeBars,
    });
  }

  const tradeDay = storeBars[storeBars.length - 1]?.tradeDay || latestTradeDayFromCandles(candles);
  const storedCandles = loadIntradayCandlesFromStore({
    quoteCode,
    timeframe,
    tradeDay,
    limit: normalizedLimit,
  });
  const merged = mergeIntradayCandles(storedCandles, candles, timeframe);
  const filled = fillIntradayCandleGaps(merged, timeframe, { latestDayOnly: true });
  return filled.slice(-normalizedLimit);
}

function mergeAndPersistLongCandles({
  quoteCode,
  timeframe = '1d',
  limit = 120,
  candles = [],
  source = null,
} = {}) {
  const tf = String(timeframe || '');
  if (!FUTURES_LONG_KLINE_KEYS.has(tf)) return Array.isArray(candles) ? candles : [];
  const normalizedLimit = Math.min(Math.max(Number(limit) || 120, 20), FUTURES_INTRADAY_STORE_MAX_LIMIT);
  const storeBars = candlesToIntradayStoreBars(candles, tf, source);
  if (storeBars.length) {
    futuresRepository.upsertIntradayBars({
      quoteCode,
      timeframe: tf,
      bars: storeBars,
    });
  }

  const storedCandles = loadLongCandlesFromStore({
    quoteCode,
    timeframe: tf,
    limit: normalizedLimit,
  });
  const merged = mergeIntradayCandles(storedCandles, candles, tf);
  return merged.slice(-normalizedLimit);
}

function normalizeQuoteCode(input) {
  const text = String(input || '')
    .trim()
    .replace(/\s+/g, '');

  if (!text) {
    throw new HttpError(400, '品种代码不能为空');
  }

  const dotMatch = text.match(/^(\d{2,3})[._-]([A-Za-z0-9]+)$/);
  if (dotMatch) {
    const market = Number(dotMatch[1]);
    const code = dotMatch[2];
    return {
      market,
      code,
      secid: `${market}.${code}`,
      quoteCode: `${market}.${code}`,
      staticCode: `${market}_${code}`,
    };
  }

  const raw = text.replace(/[._-]/g, '');
  if (/^\d{2,3}[A-Za-z0-9]+$/.test(raw)) {
    const market = Number(raw.slice(0, 3));
    const code = raw.slice(3);
    if (Number.isFinite(market) && code) {
      return {
        market,
        code,
        secid: `${market}.${code}`,
        quoteCode: `${market}.${code}`,
        staticCode: `${market}_${code}`,
      };
    }
  }

  throw new HttpError(400, `无法识别品种代码: ${input}。请使用标准代码，如 101.GC00Y`);
}

function isFuturesSuggestItem(item) {
  if (!item || !item.QuoteID) return false;
  if (!/^\d+\.[A-Za-z0-9\-]+$/.test(String(item.QuoteID))) return false;
  if (String(item.SecurityTypeName || '') === '期货') return true;

  const classify = String(item.Classify || '');
  if (classify === 'UniversalFutures' || classify === 'Futures') return true;
  if (classify.endsWith('Futures')) return true;

  const jys = String(item.JYS || '').toUpperCase();
  return ['SHFE', 'DCE', 'CZCE', 'INE', 'CFFEX', 'GFEX', 'COMEX', 'NYMEX', 'IPE', 'SGX', 'NYBOT', 'MDEX', 'COBOT'].includes(jys);
}

async function queryFuturesSuggest(input, count = 40) {
  const keyword = String(input || '').trim();
  if (!keyword) return [];

  const url = new URL('https://searchapi.eastmoney.com/api/suggest/get');
  url.searchParams.set('input', keyword);
  url.searchParams.set('type', '14');
  url.searchParams.set('count', String(count));

  const payload = await requestJson(url.toString(), 8000);
  const rows = payload?.QuotationCodeTable?.Data || [];
  return rows.filter(isFuturesSuggestItem);
}

function isShortAlphabetCode(input) {
  return /^[A-Za-z]{1,4}$/.test(String(input || '').trim());
}

function isDomesticContractCode(code, prefix) {
  const text = String(code || '').trim().toLowerCase();
  const p = String(prefix || '').trim().toLowerCase();
  if (!text || !p) return false;
  return text.startsWith(p) && /\d{3,4}$/.test(text.slice(p.length));
}

async function resolveDomesticPrefixContract(prefix) {
  const p = String(prefix || '').trim().toLowerCase();
  if (!p) return null;

  const yy = Number(new Date().getFullYear().toString().slice(-2));
  const probeInputs = Array.from(new Set([
    `${p}2`,
    `${p}${yy}`,
    `${p}${yy + 1}`,
    `${p}${yy - 1}`,
    `${p}`,
  ]));
  const candidates = [];

  for (const probe of probeInputs) {
    const rows = await queryFuturesSuggest(probe, 120);
    rows
      .filter((item) => isDomesticContractCode(item.Code, p))
      .forEach((item) => candidates.push(item));
  }

  if (!candidates.length) return null;

  const unique = Array.from(new Map(
    candidates.map((item) => [String(item.QuoteID), item]),
  ).values());

  unique.sort((a, b) => String(b.Code || '').localeCompare(String(a.Code || '')));
  const top = unique.slice(0, 8);

  const scored = await Promise.all(top.map(async (item) => {
    const normalized = normalizeQuoteCode(item.QuoteID);
    try {
      const quote = await fetchRealtimeQuote(normalized);
      return {
        item,
        normalized,
        volume: Number(quote.volume || 0),
      };
    } catch {
      return {
        item,
        normalized,
        volume: -1,
      };
    }
  }));

  scored.sort((a, b) => {
    if (a.volume !== b.volume) return b.volume - a.volume;
    return String(b.item.Code || '').localeCompare(String(a.item.Code || ''));
  });

  return scored[0]?.normalized || null;
}

async function resolveQuoteCode(input, { nameHint = '' } = {}) {
  const rawInput = String(input || '').trim();
  if (!rawInput) {
    throw new HttpError(400, '品种代码不能为空');
  }

  const upperInput = rawInput.toUpperCase();
  const aliasByName = FUTURES_ALIAS_NAME_MAP[String(nameHint || '').trim()];

  if (/^\d{2,3}[._-][A-Za-z0-9]+$/.test(rawInput) || /^\d{2,3}[A-Za-z0-9]+$/.test(rawInput)) {
    const normalized = normalizeQuoteCode(rawInput);
    // 输入了短代码（如 101.AU）时，优先按中文品种名映射到标准主连代码。
    if (aliasByName && String(normalized.code || '').length <= 3) {
      return normalizeQuoteCode(aliasByName);
    }
    return normalized;
  }

  const aliasByCode = FUTURES_ALIAS_CODE_MAP[upperInput];
  if (aliasByCode) {
    return normalizeQuoteCode(aliasByCode);
  }
  if (aliasByName) {
    return normalizeQuoteCode(aliasByName);
  }

  // 对短字母代码（如 LC、AU）优先解析为当前主力/活跃合约，避免只返回品种前缀。
  if (isShortAlphabetCode(rawInput)) {
    const resolvedDomestic = await resolveDomesticPrefixContract(rawInput);
    if (resolvedDomestic) {
      return resolvedDomestic;
    }
  }

  const candidates = [rawInput];
  if (nameHint && String(nameHint).trim() && String(nameHint).trim() !== rawInput) {
    candidates.push(String(nameHint).trim());
  }

  for (const candidate of candidates) {
    const rows = await queryFuturesSuggest(candidate);
    const exact = rows.find((item) => String(item.Code || '').toUpperCase() === upperInput);
    const preferred = exact || rows[0];
    if (preferred?.QuoteID) {
      return normalizeQuoteCode(preferred.QuoteID);
    }
  }

  throw new HttpError(
    400,
    `未识别到可用期货代码: ${rawInput}。可尝试 101.GC00Y（黄金）、101.SI00Y（白银）、102.CL00Y（原油）或具体合约如 113.au2606`,
  );
}

async function requestJson(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (peng-stock-analysis futures-monitor)',
      },
    });

    if (!response.ok) {
      throw new HttpError(response.status, `期货行情请求失败: ${response.status}`);
    }

    const payload = await response.json();
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new HttpError(504, '期货行情请求超时');
    }
    if (error instanceof HttpError) throw error;

    const msg = String(error?.message || '');
    const causeText = buildErrorCauseText(error);
    if (msg.includes('fetch failed')) {
      console.error('[futures-fetch-failed]', {
        at: nowLocalDateTime(),
        remoteUrl: String(url || ''),
        timeoutMs,
        errorMessage: msg,
        errorCause: causeText || null,
      });
      if (error?.stack) {
        console.error('[futures-fetch-failed][trace]', error.stack);
      }
    }
    const causeCode = String(error?.cause?.code || '');
    const shouldFallbackByCurl = (
      /eastmoney\.com/i.test(String(url || ''))
      && (
        msg.includes('fetch failed')
        || causeCode === 'ENOTFOUND'
        || causeCode === 'ECONNRESET'
      )
    );

    if (shouldFallbackByCurl) {
      try {
        return await requestJsonByCurl(url, timeoutMs);
      } catch (curlError) {
        const httpError = new HttpError(502, `期货行情请求异常: ${msg}; curl降级失败: ${briefErrorMessage(curlError)}`);
        attachDebugErrorMeta(httpError, {
          cause: error,
          debug: {
            url: String(url || ''),
            fetchCause: causeText || null,
            curlCause: buildErrorCauseText(curlError),
          },
        });
        throw httpError;
      }
    }

    const httpError = new HttpError(502, `期货行情请求异常: ${msg}`);
    attachDebugErrorMeta(httpError, {
      cause: error,
      debug: {
        url: String(url || ''),
        fetchCause: causeText || null,
      },
    });
    throw httpError;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeProxyUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.hostname === 'localhost') {
      parsed.hostname = '127.0.0.1';
    }
    return parsed.toString();
  } catch {
    return raw.replace('://localhost', '://127.0.0.1');
  }
}

function resolveCurlProxyUrl(rawUrl) {
  let protocol = 'https:';
  try {
    protocol = String(new URL(String(rawUrl || '')).protocol || 'https:');
  } catch {}

  const candidates = protocol === 'http:'
    ? [
      process.env.http_proxy,
      process.env.HTTP_PROXY,
      process.env.https_proxy,
      process.env.HTTPS_PROXY,
    ]
    : [
      process.env.https_proxy,
      process.env.HTTPS_PROXY,
      process.env.http_proxy,
      process.env.HTTP_PROXY,
    ];
  return candidates
    .map((item) => normalizeProxyUrl(item))
    .find(Boolean) || '';
}

function shouldRetryCurlRequest(error) {
  const msg = briefErrorMessage(error, '').toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('could not resolve host')
    || msg.includes('empty reply from server')
    || msg.includes('failed to connect')
    || msg.includes('timed out')
    || msg.includes('connection reset')
    || msg.includes('tls')
    || msg.includes('ssl')
  );
}

async function requestJsonByCurlOnce(url, timeoutMs = 9000, { proxyUrl = '' } = {}) {
  const seconds = Math.max(3, Math.min(20, Math.ceil(Number(timeoutMs) / 1000)));
  const args = [
    '-sS',
    '--max-time',
    String(seconds),
    '-H',
    'User-Agent: Mozilla/5.0 (peng-stock-analysis futures-monitor)',
    '-H',
    'Accept: application/json,text/plain,*/*',
  ];

  const useProxy = Boolean(proxyUrl);
  if (useProxy) {
    args.push('--noproxy', '', '--proxy', proxyUrl);
  } else {
    args.push('--noproxy', '*', '--proxy', '');
  }
  args.push(String(url));

  const env = useProxy
    ? {
      ...process.env,
      http_proxy: proxyUrl,
      https_proxy: proxyUrl,
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
    }
    : {
      ...process.env,
      http_proxy: '',
      https_proxy: '',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
    };

  const { stdout } = await execFileAsync('curl', args, {
    maxBuffer: 12 * 1024 * 1024,
    env,
  });

  const text = String(stdout || '').trim();
  if (!text) {
    throw new Error('curl返回空响应');
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`curl响应非JSON: ${text.slice(0, 120)}`);
  }
}

async function requestJsonByCurl(url, timeoutMs = 9000) {
  const proxyUrl = resolveCurlProxyUrl(url);
  const attempts = [
    { name: 'direct', proxyUrl: '', retries: 2 },
  ];
  if (proxyUrl) {
    attempts.push({ name: 'proxy', proxyUrl, retries: 2 });
  }

  let lastError = null;
  for (const attempt of attempts) {
    for (let i = 0; i < attempt.retries; i += 1) {
      try {
        return await requestJsonByCurlOnce(url, timeoutMs, { proxyUrl: attempt.proxyUrl });
      } catch (error) {
        lastError = error;
        const shouldRetry = shouldRetryCurlRequest(error) && (i < attempt.retries - 1);
        if (!shouldRetry) break;
        // 轻量退避，减少瞬时DNS/链路抖动造成的连续失败。
        await new Promise((resolve) => setTimeout(resolve, 120 * (i + 1)));
      }
    }
  }

  throw lastError || new Error('curl请求失败');
}

async function requestBufferByCurl(url, timeoutMs = 9000, { referer = '' } = {}) {
  const proxyUrl = resolveCurlProxyUrl(url);
  const attempts = [
    { proxyUrl: '', retries: 2 },
  ];
  if (proxyUrl) {
    attempts.push({ proxyUrl, retries: 2 });
  }

  let lastError = null;
  for (const attempt of attempts) {
    for (let i = 0; i < attempt.retries; i += 1) {
      try {
        return await requestBufferByCurlOnce(url, timeoutMs, {
          referer,
          proxyUrl: attempt.proxyUrl,
        });
      } catch (error) {
        lastError = error;
        const shouldRetry = shouldRetryCurlRequest(error) && (i < attempt.retries - 1);
        if (!shouldRetry) break;
        await new Promise((resolve) => setTimeout(resolve, 120 * (i + 1)));
      }
    }
  }

  throw lastError || new Error('curl请求失败');
}

async function requestBufferByCurlOnce(url, timeoutMs = 9000, { referer = '', proxyUrl = '' } = {}) {
  const seconds = Math.max(3, Math.min(20, Math.ceil(Number(timeoutMs) / 1000)));
  const args = [
    '-sS',
    '--compressed',
    '--max-time',
    String(seconds),
    '-H',
    'User-Agent: Mozilla/5.0 (peng-stock-analysis futures-monitor tencent curl)',
  ];

  const useProxy = Boolean(proxyUrl);
  if (useProxy) {
    args.push('--noproxy', '', '--proxy', proxyUrl);
  } else {
    args.push('--noproxy', '*', '--proxy', '');
  }

  if (referer) {
    args.push('-H', `Referer: ${referer}`);
  }

  args.push(String(url));

  const env = useProxy
    ? {
      ...process.env,
      http_proxy: proxyUrl,
      https_proxy: proxyUrl,
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
    }
    : {
      ...process.env,
      http_proxy: '',
      https_proxy: '',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
    };
  const { stdout } = await execFileAsync('curl', args, {
    maxBuffer: 12 * 1024 * 1024,
    env,
    encoding: 'buffer',
  });
  const buffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || []);
  if (!buffer.length) {
    throw new Error('curl返回空响应');
  }
  return buffer;
}

async function requestText(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (peng-stock-analysis futures-monitor)',
      },
    });

    if (!response.ok) {
      throw new HttpError(response.status, `期货预设请求失败: ${response.status}`);
    }

    return response.text();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new HttpError(504, '期货预设请求超时');
    }
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, `期货预设请求异常: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchUniversalFuturesPresets() {
  const rows = await queryFuturesSuggest('00Y', 200);
  return rows
    .filter((item) => item.Classify === 'UniversalFutures' && /^\d+\.[A-Za-z0-9]+$/.test(String(item.QuoteID || '')))
    .map((item) => ({
      exchange: String(item.JYS || `MKT${item.MktNum || ''}`),
      name: String(item.Name || item.Code || item.QuoteID),
      quoteCode: String(item.QuoteID),
      source: 'eastmoney.searchapi',
      sort: 1000,
    }));
}

function parseDomesticPresetsFromGlobalFutureScript(scriptText = '') {
  const marker = 'var or=[';
  const endMarker = '];function cr';
  const start = scriptText.indexOf(marker);
  if (start < 0) return [];

  const tail = scriptText.slice(start + marker.length);
  const end = tail.indexOf(endMarker);
  if (end < 0) return [];

  const listText = tail.slice(0, end);
  const items = [];
  const exchangePattern = /\{id:"([^"]+)",name:"([^"]+)",sort:(\d+),types:\[([^\]]*)\]\}/g;

  for (const match of listText.matchAll(exchangePattern)) {
    const exchangeId = String(match[1] || '').trim();
    const exchangeName = String(match[2] || '').trim();
    const exchangeSort = Number(match[3] || 999);
    const typesText = match[4] || '';
    const typePattern = /\{vcode:"([^"]+)",vname:"([^"]+)"/g;

    let typeIndex = 0;
    for (const type of typesText.matchAll(typePattern)) {
      const vcode = String(type[1] || '').trim();
      const vname = String(type[2] || '').trim();
      if (!vcode || !vname) continue;

      items.push({
        exchange: `${exchangeName}(${exchangeId})`,
        name: `${vname}(自动匹配当前合约)`,
        quoteCode: vcode,
        source: 'eastmoney.globalfuture.js',
        sort: exchangeSort * 1000 + typeIndex,
      });
      typeIndex += 1;
    }
  }

  return items;
}

async function fetchDomesticFuturesPresets() {
  const script = await requestText('https://quote.eastmoney.com/newstatic/build/globalfuture.js', 12000);
  return parseDomesticPresetsFromGlobalFutureScript(script);
}

function dedupeFuturesPresets(rows = []) {
  const map = new Map();

  rows.forEach((item) => {
    const quoteCode = String(item.quoteCode || '').trim();
    if (!quoteCode) return;
    const key = quoteCode.toUpperCase();
    if (!map.has(key)) {
      map.set(key, {
        exchange: String(item.exchange || '其他'),
        name: String(item.name || quoteCode),
        quoteCode,
        source: String(item.source || ''),
        sort: Number(item.sort || 999999),
      });
    }
  });

  return Array.from(map.values()).sort((a, b) => {
    if (a.sort !== b.sort) return a.sort - b.sort;
    if (a.exchange !== b.exchange) return a.exchange.localeCompare(b.exchange);
    return a.name.localeCompare(b.name);
  });
}

function buildFuturesBasicItem({
  quoteCode = '',
  market = null,
  code = '',
  name = '',
  exchange = '',
  source = '',
  syncedAt = '',
} = {}) {
  const normalizedQuoteCode = String(quoteCode || '').trim().toUpperCase();
  const rawCode = String(code || normalizedQuoteCode.split('.').pop() || '').trim().toUpperCase();
  const normalizedCode = rawCode.includes('.') ? rawCode.split('.').pop() : rawCode;
  const normalizedExchange = String(exchange || '').trim();
  return {
    quoteCode: normalizedQuoteCode,
    market: Number.isFinite(Number(market)) ? Number(market) : null,
    code: normalizedCode,
    name: String(name || '').trim() || null,
    exchange: normalizedExchange || null,
    tradingHours: getOfficialFuturesTradingHours({
      quoteCode: normalizedQuoteCode,
      market,
      code: normalizedCode,
      exchange: normalizedExchange,
      name,
    }),
    source: String(source || '').trim() || null,
    syncedAt: String(syncedAt || '').trim() || null,
  };
}

async function fetchRealtimeQuote(symbol) {
  const url = new URL(`https://futsseapi.eastmoney.com/static/${symbol.staticCode}_qt`);
  url.searchParams.set('field', 'dm,name,p,zde,zf,o,h,l,zs,vol,amount,ccl,wp,np,utime');
  url.searchParams.set('token', FUTURES_QUOTE_TOKEN);

  try {
    const payload = await requestJson(url.toString(), 8000);
    const qt = payload?.qt || payload?.data?.qt || payload?.data || {};

    const price = toNum(qt.p);
    const rawPrevClose = toNum(qt.zs);
    const rawChange = toNum(qt.zde);
    const derivedPrevClose = (
      price != null
      && rawChange != null
    ) ? (price - rawChange) : null;

    let prevClose = rawPrevClose;
    if (derivedPrevClose != null) {
      const inconsistent = (
        prevClose != null
        && Math.abs(prevClose - derivedPrevClose) > Math.max(Math.abs(derivedPrevClose) * 0.001, 0.01)
      );
      if (prevClose == null || inconsistent) {
        prevClose = derivedPrevClose;
      }
    }
    const { change, changePct } = normalizeQuoteChangeMetrics({
      price,
      prevClose,
      change: rawChange,
      changePct: qt.zf,
    });

    return {
      name: qt.name || qt.mc || symbol.code,
      code: symbol.code,
      quoteCode: symbol.quoteCode,
      market: symbol.market,
      price,
      change,
      changePct,
      open: toNum(qt.o),
      high: toNum(qt.h),
      low: toNum(qt.l),
      prevClose,
      volume: toNum(qt.vol) ?? 0,
      amount: toNum(qt.amount) ?? 0,
      openInterest: toNum(qt.ccl),
      bidVolume: toNum(qt.wp),
      askVolume: toNum(qt.np),
      tradeTime: toLocalDateTime(qt.utime, null),
      dataSource: 'eastmoney.futsseapi',
      fetchedAt: nowLocalDateTime(),
    };
  } catch (error) {
    const tencentCode = toTencentFuturesCode(symbol);
    if (tencentCode) {
      const tencentUrl = new URL('https://qt.gtimg.cn/');
      tencentUrl.searchParams.set('q', tencentCode);
      try {
        const response = await fetch(tencentUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (peng-stock-analysis futures-monitor tencent)',
            Referer: 'https://gu.qq.com/',
          },
        });
        if (!response.ok) {
          throw new HttpError(response.status, `腾讯期货行情请求失败: ${response.status}`);
        }

        const text = decodeGbkPayload(Buffer.from(await response.arrayBuffer()));
        const matched = text.match(new RegExp(`v_${tencentCode}="([^"]*)"`));
        if (!matched) {
          throw new HttpError(502, '腾讯期货行情数据格式异常');
        }

        const parts = String(matched[1] || '').split(',');
        if (parts.length < 14) {
          throw new HttpError(502, '腾讯期货行情字段不足');
        }

        const price = toNum(parts[0]);
        const prevClose = toNum(parts[7]);
        const rawChange = (
          price != null
          && prevClose != null
        ) ? (price - prevClose) : null;
        const { change, changePct } = normalizeQuoteChangeMetrics({
          price,
          prevClose,
          change: rawChange,
          changePct: parts[1],
        });

        return {
          name: String(parts[13] || '').trim() || symbol.code,
          code: symbol.code,
          quoteCode: symbol.quoteCode,
          market: symbol.market,
          price,
          change,
          changePct,
          open: toNum(parts[8]),
          high: toNum(parts[4]),
          low: toNum(parts[5]),
          prevClose,
          volume: toNum(parts[9]) ?? 0,
          amount: 0,
          openInterest: null,
          bidVolume: null,
          askVolume: null,
          tradeTime: formatTencentFuturesTradeTime(parts[12], parts[6]),
          dataSource: 'tencent.qt.futures',
          fetchedAt: nowLocalDateTime(),
        };
      } catch (fallbackError) {
        if (String(fallbackError?.message || '').includes('fetch failed')) {
          console.error('[futures-fetch-failed]', {
            at: nowLocalDateTime(),
            remoteUrl: tencentUrl.toString(),
            quoteCode: symbol?.quoteCode || null,
            tencentCode,
            errorMessage: String(fallbackError?.message || ''),
          });
          if (fallbackError?.stack) {
            console.error('[futures-fetch-failed][trace]', fallbackError.stack);
          }
        }

        try {
          const buffer = await requestBufferByCurl(tencentUrl.toString(), 8000, {
            referer: 'https://gu.qq.com/',
          });
          const text = decodeGbkPayload(buffer);
          const matched = text.match(new RegExp(`v_${tencentCode}="([^"]*)"`));
          if (!matched) {
            throw new HttpError(502, '腾讯期货行情数据格式异常');
          }

          const parts = String(matched[1] || '').split(',');
          if (parts.length < 14) {
            throw new HttpError(502, '腾讯期货行情字段不足');
          }

          const price = toNum(parts[0]);
          const prevClose = toNum(parts[7]);
          const rawChange = (
            price != null
            && prevClose != null
          ) ? (price - prevClose) : null;
          const { change, changePct } = normalizeQuoteChangeMetrics({
            price,
            prevClose,
            change: rawChange,
            changePct: parts[1],
          });

          return {
            name: String(parts[13] || '').trim() || symbol.code,
            code: symbol.code,
            quoteCode: symbol.quoteCode,
            market: symbol.market,
            price,
            change,
            changePct,
            open: toNum(parts[8]),
            high: toNum(parts[4]),
            low: toNum(parts[5]),
            prevClose,
            volume: toNum(parts[9]) ?? 0,
            amount: 0,
            openInterest: null,
            bidVolume: null,
            askVolume: null,
            tradeTime: formatTencentFuturesTradeTime(parts[12], parts[6]),
            dataSource: 'tencent.qt.futures',
            fetchedAt: nowLocalDateTime(),
          };
        } catch (curlError) {
          console.error('[futures-fetch-failed][curl]', {
            at: nowLocalDateTime(),
            remoteUrl: tencentUrl.toString(),
            quoteCode: symbol?.quoteCode || null,
            tencentCode,
            errorMessage: String(curlError?.message || ''),
          });
          if (curlError?.stack) {
            console.error('[futures-fetch-failed][curl-trace]', curlError.stack);
          }
        }
      }
    }

    throw error;
  }
}

function buildQuoteFallbackFromCandles(symbol, candles = []) {
  const list = Array.isArray(candles) ? candles.filter(Boolean) : [];
  if (!list.length) return null;
  const last = list[list.length - 1];
  const prev = list.length > 1 ? list[list.length - 2] : null;
  const price = toNum(last?.close);
  if (price == null) return null;

  const prevClose = toNum(prev?.close) ?? toNum(last?.open);
  const { change, changePct } = normalizeQuoteChangeMetrics({
    price,
    prevClose,
    change: prevClose != null ? (price - prevClose) : null,
    changePct: null,
  });

  return {
    name: symbol.code,
    code: symbol.code,
    quoteCode: symbol.quoteCode,
    market: symbol.market,
    price,
    change,
    changePct,
    open: toNum(last?.open),
    high: toNum(last?.high),
    low: toNum(last?.low),
    prevClose: prevClose ?? null,
    volume: toNum(last?.volume) ?? 0,
    amount: toNum(last?.amount) ?? 0,
    openInterest: null,
    bidVolume: null,
    askVolume: null,
    tradeTime: toLocalDateTime(last?.date, null),
    dataSource: 'local.candles.fallback',
    fetchedAt: nowLocalDateTime(),
  };
}

async function fetchKline(symbol, { timeframe = '60m', limit = 120 } = {}) {
  const frame = FUTURES_TIMEFRAME_MAP[timeframe];
  if (!frame || !frame.code) {
    throw new HttpError(400, `不支持的时间粒度: ${timeframe}`);
  }
  const normalizedLimit = Math.min(Math.max(Number(limit) || 120, 30), 2500);

  // 对1分钟K线，从昨天开始取数据（覆盖夜盘品种），由 latestDayOnly 过滤出当天走势
  const isIntraday1m = timeframe === '1m';
  let begParam = '0';
  if (isIntraday1m) {
    const yesterday = new Date(Date.now() - 86400000);
    const y = yesterday.getFullYear();
    const m = String(yesterday.getMonth() + 1).padStart(2, '0');
    const d = String(yesterday.getDate()).padStart(2, '0');
    begParam = `${y}${m}${d}`;
  }

  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');
  url.searchParams.set('secid', symbol.secid);
  url.searchParams.set('ut', FUTURES_HISTORY_UT);
  url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6');
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58');
  url.searchParams.set('klt', frame.code);
  url.searchParams.set('fqt', '0');
  url.searchParams.set('beg', begParam);
  url.searchParams.set('end', '20500101');
  url.searchParams.set('lmt', String(normalizedLimit));

  const payload = await requestJson(url.toString(), 9000);
  const rows = payload?.data?.klines || [];
  let candles = rows.map(parseKlineRow).filter(Boolean);
  if (isIntraday1m) {
    candles = fillIntradayCandleGaps(candles, timeframe, { latestDayOnly: true });
  }
  if (!candles.length) {
    throw new HttpError(404, `未获取到 ${symbol.quoteCode} 的K线数据`);
  }
  return candles.slice(-normalizedLimit);
}

async function fetchTickMx(symbol, { limit = 600 } = {}) {
  const normalized = Math.min(Math.max(Number(limit) || 600, 60), 1999);
  const url = new URL(`https://futsseapi.eastmoney.com/static/${symbol.staticCode}_mx/${normalized}`);
  url.searchParams.set('token', FUTURES_QUOTE_TOKEN);

  const payload = await requestJson(url.toString(), 8000);
  const rows = payload?.mx || [];
  if (!rows.length) {
    throw new HttpError(404, `未获取到 ${symbol.quoteCode} 的成交明细`);
  }

  return rows
    .map((item) => ({
      ts: Number(item.utime),
      price: toNum(item.p),
      volume: toNum(item.vol) ?? 0,
    }))
    .filter((item) => Number.isFinite(item.ts) && Number.isFinite(item.price) && item.price > 0)
    .sort((a, b) => a.ts - b.ts);
}

function aggregateTicksToCandles(ticks, timeframe, limit) {
  const intervalMap = {
    '30s': 0.5,
    '1m': 1,
    '5m': 5,
    '15m': 15,
    '30m': 30,
    '60m': 60,
    '1d': 1440,
    '1w': 10080,
    '1M': 43200,
  };
  const intervalMinutes = intervalMap[timeframe] || 60;
  const bucketSpan = intervalMinutes * 60;

  const buckets = new Map();
  ticks.forEach((tick) => {
    const bucketTs = Math.floor(tick.ts / bucketSpan) * bucketSpan;
    const existing = buckets.get(bucketTs);
    if (!existing) {
      buckets.set(bucketTs, {
        ts: bucketTs,
        date: toDateString(bucketTs, intervalMinutes),
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.volume,
        amount: (tick.price || 0) * (tick.volume || 0),
      });
      return;
    }

    existing.high = Math.max(existing.high, tick.price);
    existing.low = Math.min(existing.low, tick.price);
    existing.close = tick.price;
    existing.volume += tick.volume || 0;
    existing.amount += (tick.price || 0) * (tick.volume || 0);
  });

  const normalizedLimit = Math.max(Number(limit) || 120, 20);
  let rawCandles = Array.from(buckets.values()).sort((a, b) => a.ts - b.ts);
  if (!rawCandles.length) return [];

  if (timeframe === '1m') {
    const latestDay = String(rawCandles[rawCandles.length - 1]?.date || '').slice(0, 10);
    const latestDayCandles = rawCandles.filter((item) => String(item?.date || '').slice(0, 10) === latestDay);
    if (latestDayCandles.length) {
      rawCandles = latestDayCandles;
    }
  }

  const shouldFillIntradayGaps = ['30s', '1m', '5m', '15m', '30m', '60m'].includes(String(timeframe || ''));
  let finalCandles = rawCandles;

  if (shouldFillIntradayGaps) {
    const byTs = new Map(rawCandles.map((item) => [item.ts, item]));
    const first = rawCandles[0];
    const last = rawCandles[rawCandles.length - 1];
    const endTs = last.ts;
    const startTs = first.ts;

    const continuous = [];
    let prevClose = first.close;
    for (let ts = startTs; ts <= endTs; ts += bucketSpan) {
      const hit = byTs.get(ts);
      if (hit) {
        continuous.push(hit);
        prevClose = hit.close;
      } else {
        continuous.push({
          ts,
          date: toDateString(ts, intervalMinutes),
          open: prevClose,
          high: prevClose,
          low: prevClose,
          close: prevClose,
          volume: 0,
          amount: 0,
        });
      }
    }
    finalCandles = continuous;
  }

  return finalCandles
    .slice(-normalizedLimit)
    .map((item) => ({
      date: item.date,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume,
      amount: item.amount,
    }));
}

async function fetchCandlesWithFallback(symbol, { timeframe = '60m', limit = 120 } = {}) {
  if (timeframe === '30s') {
    const ticks = await fetchTickMx(symbol, {
      limit: Math.min(Math.max(limit * 8, 180), 1999),
    });
    return {
      candles: aggregateTicksToCandles(ticks, timeframe, limit),
      candleDataSource: 'eastmoney.futsseapi.mx',
      degraded: false,
      warning: null,
    };
  }

  try {
    const candles = await fetchKline(symbol, { timeframe, limit });
    return {
      candles,
      candleDataSource: 'eastmoney.push2his',
      degraded: false,
      warning: null,
    };
  } catch (error) {
    logFuturesMonitorIssue({
      level: 'warn',
      stage: 'kline-primary-failed',
      symbol,
      timeframe,
      limit,
      error,
      extra: { fallback: 'tick-mx-aggregate' },
    });

    if (FUTURES_LONG_KLINE_KEYS.has(String(timeframe || ''))) {
      throw error;
    }

    let ticks = [];
    try {
      ticks = await fetchTickMx(symbol, {
        limit: Math.min(Math.max(limit * 20, 180), 1999),
      });
    } catch (fallbackError) {
      logFuturesMonitorIssue({
        level: 'error',
        stage: 'tick-fallback-failed',
        symbol,
        timeframe,
        limit,
        error: fallbackError,
        extra: { primaryError: error?.message || '未知错误' },
      });
      throw fallbackError;
    }

    const candles = aggregateTicksToCandles(ticks, timeframe, limit);
    if (!candles.length) {
      logFuturesMonitorIssue({
        level: 'error',
        stage: 'tick-fallback-empty',
        symbol,
        timeframe,
        limit,
        error,
      });
      throw error;
    }
    return {
      candles,
      candleDataSource: 'eastmoney.futsseapi.mx',
      degraded: true,
      warning: `K线接口不可用，已降级为成交明细聚合: ${error.message}`,
    };
  }
}

function groupSymbolsByCategory(categories, symbols) {
  const map = new Map(categories.map((category) => [category.id, { ...category, symbols: [] }]));
  symbols.forEach((symbol) => {
    const category = map.get(symbol.categoryId);
    if (category) {
      category.symbols.push(symbol);
    }
  });
  return Array.from(map.values());
}

function normalizeMonitorQuoteCodeToken(input) {
  const text = String(input || '')
    .trim()
    .replace(/\s+/g, '');
  if (!text) return '';
  try {
    return normalizeQuoteCode(text).quoteCode.toUpperCase();
  } catch {
    return text.toUpperCase().replace(/[._-]/g, '.');
  }
}

function parseMonitorQuoteCodes(input) {
  if (input === undefined || input === null || input === '') return [];
  const values = Array.isArray(input) ? input : [input];
  const tokens = values
    .flatMap((item) => String(item || '').split(/[\s,;|]+/))
    .map((item) => normalizeMonitorQuoteCodeToken(item))
    .filter(Boolean);
  return Array.from(new Set(tokens));
}

export const futuresService = {
  getTimeframes() {
    return Object.entries(FUTURES_TIMEFRAME_MAP).map(([key, item]) => ({
      key,
      label: item.label,
      code: item.code,
    }));
  },

  async resolveSymbol(input, { nameHint = '' } = {}) {
    return resolveQuoteCode(input, { nameHint });
  },

  async getMonitorByQuoteCodes(payload = {}) {
    const quoteCodes = parseMonitorQuoteCodes([
      payload.quoteCode,
      payload.code,
      payload.quoteCodes,
    ]);
    const timeframe = String(payload.timeframe || '30s');
    const hasExplicitLimit = payload.limit !== undefined && payload.limit !== null && payload.limit !== '';
    const defaultLimit = FUTURES_MONITOR_DEFAULT_LIMIT_MAP[timeframe]
      || (FUTURES_LONG_KLINE_KEYS.has(timeframe) ? 100 : 120);
    const parsedLimit = Number(hasExplicitLimit ? payload.limit : defaultLimit);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : defaultLimit;

    if (!FUTURES_TIMEFRAME_MAP[timeframe]) {
      throw new HttpError(400, `不支持的时间粒度: ${timeframe}`);
    }

    if (!quoteCodes.length) {
      return {
        timeframe,
        timeframeLabel: FUTURES_TIMEFRAME_MAP[timeframe].label,
        total: 0,
        success: 0,
        failed: 0,
        categories: [],
        quoteCodes: [],
        items: [],
      };
    }

    const symbols = quoteCodes.map((quoteCode) => {
      const normalized = normalizeQuoteCode(quoteCode);
      return {
        id: normalized.quoteCode,
        categoryId: null,
        categoryName: '-',
        name: String(payload.nameMap?.[normalized.quoteCode] || normalized.code || normalized.quoteCode).trim(),
        quoteCode: normalized.quoteCode,
        market: normalized.market,
        code: normalized.code,
        tradingHours: getOfficialFuturesTradingHours(normalized),
      };
    });

    const items = await Promise.all(symbols.map(async (symbol) => {
      const normalized = normalizeQuoteCode(symbol.quoteCode || `${symbol.market}.${symbol.code}`);
      const quotePromise = fetchRealtimeQuote(normalized)
        .then((data) => ({ ok: true, data }))
        .catch((error) => ({ ok: false, error }));
      const isLongTimeframe = FUTURES_LONG_KLINE_KEYS.has(timeframe);
      const rawCandlesResult = isLongTimeframe
        ? { ok: false, error: new Error('long-local-first') }
        : await fetchCandlesWithFallback(normalized, { timeframe, limit })
          .then((data) => ({ ok: true, data }))
          .catch((error) => ({ ok: false, error }));
      const quoteResult = await quotePromise;
      let candlesResult = rawCandlesResult;
      let finalQuote = quoteResult.ok ? quoteResult.data : null;

      const warningList = [];
      const errorList = [];
      const quoteErrorText = quoteResult.ok ? '' : `实时行情失败: ${quoteResult.error?.message || '未知错误'}`;

      if (timeframe === '1m') {
        if (candlesResult.ok) {
          const mergedCandles = mergeAndPersistIntradayCandles({
            quoteCode: normalized.quoteCode,
            timeframe,
            limit,
            candles: candlesResult.data.candles || [],
            source: candlesResult.data.candleDataSource || null,
          });
          candlesResult = {
            ...candlesResult,
            data: {
              ...candlesResult.data,
              candles: mergedCandles,
              candleDataSource: candlesResult.data.candleDataSource === LOCAL_INTRADAY_DATA_SOURCE
                ? LOCAL_INTRADAY_DATA_SOURCE
                : `${candlesResult.data.candleDataSource || 'unknown'}+${LOCAL_INTRADAY_DATA_SOURCE}`,
            },
          };
        } else {
          const cachedCandles = loadIntradayCandlesFromStore({
            quoteCode: normalized.quoteCode,
            timeframe,
            limit,
          });
          if (cachedCandles.length) {
            candlesResult = {
              ok: true,
              data: {
                candles: cachedCandles,
                candleDataSource: LOCAL_INTRADAY_DATA_SOURCE,
                degraded: true,
                warning: `K线接口不可用，已回退本地缓存: ${rawCandlesResult.error?.message || '未知错误'}`,
              },
            };
          }
        }
      } else if (FUTURES_LONG_KLINE_KEYS.has(timeframe)) {
        let localCandles = loadLongCandlesFromStore({
          quoteCode: normalized.quoteCode,
          timeframe,
          limit,
        });
        const currentDerived = buildCurrentLongCandleFromMinuteStore({
          quoteCode: normalized.quoteCode,
          timeframe,
        });
        if (currentDerived) {
          localCandles = mergeAndPersistLongCandles({
            quoteCode: normalized.quoteCode,
            timeframe,
            limit,
            candles: [currentDerived],
            source: LOCAL_DERIVED_INTRADAY_SOURCE,
          });
        }

        const cacheComplete = isLongCacheComplete(localCandles, timeframe, limit);
        if (!cacheComplete) {
          triggerLongKlineBackgroundSync({
            normalized,
            timeframe,
            limit,
          });
        }

        if (localCandles.length) {
          candlesResult = {
            ok: true,
            data: {
              candles: localCandles,
              candleDataSource: LOCAL_INTRADAY_DATA_SOURCE,
              degraded: !cacheComplete,
              warning: cacheComplete ? null : 'K线优先展示本地缓存，后台正在补齐远程数据',
            },
          };
        } else {
          triggerLongKlineBackgroundSync({
            normalized,
            timeframe,
            limit,
          });
          candlesResult = {
            ok: false,
            error: new Error('本地暂无K线缓存，后台已启动补齐任务'),
          };
        }
      }

      if (!candlesResult.ok) {
        if (candlesResult.error?.message !== 'long-local-first') {
          logFuturesMonitorIssue({
            level: 'error',
            stage: 'candles-final-failed',
            symbol: normalized,
            timeframe,
            limit,
            error: candlesResult.error,
          });
        }
        errorList.push(`K线失败: ${candlesResult.error?.message || '未知错误'}`);
      } else if (candlesResult.data.warning) {
        warningList.push(candlesResult.data.warning);
      }

      if (!finalQuote && candlesResult.ok) {
        const fallbackQuote = buildQuoteFallbackFromCandles(normalized, candlesResult.data.candles || []);
        if (fallbackQuote) {
          finalQuote = fallbackQuote;
          if (quoteErrorText) {
            warningList.push(`实时行情不可用，已使用本地K线末值估算: ${quoteResult.error?.message || '未知错误'}`);
          }
        }
      }

      if (!finalQuote && quoteErrorText) {
        logFuturesMonitorIssue({
          level: 'error',
          stage: 'quote-final-failed',
          symbol: normalized,
          timeframe,
          limit,
          error: quoteResult.error,
        });
        errorList.push(quoteErrorText);
      } else if (!quoteResult.ok && finalQuote) {
        logFuturesMonitorIssue({
          level: 'warn',
          stage: 'quote-failed-fallback-used',
          symbol: normalized,
          timeframe,
          limit,
          error: quoteResult.error,
          extra: { quoteDataSource: finalQuote?.dataSource || null },
        });
      }

      return {
        id: symbol.id,
        categoryId: symbol.categoryId,
        categoryName: symbol.categoryName || '-',
        name: symbol.name,
        quoteCode: normalized.quoteCode,
        market: normalized.market,
        code: normalized.code,
        tradingHours: symbol.tradingHours || getOfficialFuturesTradingHours(normalized),
        timeframe,
        timeframeLabel: FUTURES_TIMEFRAME_MAP[timeframe].label,
        quote: finalQuote,
        candles: candlesResult.ok ? candlesResult.data.candles : [],
        candleDataSource: candlesResult.ok ? candlesResult.data.candleDataSource : null,
        warning: warningList.length ? warningList.join(' | ') : null,
        error: errorList.length ? errorList.join(' | ') : null,
      };
    }));

    const success = items.filter((item) => !item.error).length;
    const failed = items.length - success;

    return {
      timeframe,
      timeframeLabel: FUTURES_TIMEFRAME_MAP[timeframe].label,
      total: items.length,
      success,
      failed,
      categories: [],
      quoteCodes,
      items,
      fetchedAt: nowLocalDateTime(),
      failOpen: true,
    };
  },

  async listPresets({ force = false } = {}) {
    const now = Date.now();
    const cacheAlive = futuresPresetCache.items.length > 0
      && (now - futuresPresetCache.updatedAt) < FUTURES_PRESET_CACHE_TTL_MS;

    if (!force && cacheAlive) {
      return {
        items: futuresPresetCache.items,
        total: futuresPresetCache.items.length,
        cached: true,
        updatedAt: toLocalDateTime(new Date(futuresPresetCache.updatedAt), nowLocalDateTime()),
      };
    }

    const [universalResult, domesticResult] = await Promise.allSettled([
      fetchUniversalFuturesPresets(),
      fetchDomesticFuturesPresets(),
    ]);

    const universal = universalResult.status === 'fulfilled' ? universalResult.value : [];
    const domestic = domesticResult.status === 'fulfilled' ? domesticResult.value : [];

    let items = dedupeFuturesPresets([
      ...universal,
      ...domestic,
    ]);

    if (!items.length) {
      items = dedupeFuturesPresets(FUTURES_PRESET_FALLBACK);
    }

    const syncedAt = toLocalDateTime(new Date(now), nowLocalDateTime());
    const enrichedItems = items.map((item) => {
      const basic = buildFuturesBasicItem({
        quoteCode: item.quoteCode,
        code: item.quoteCode,
        name: item.name,
        exchange: item.exchange,
        source: item.source,
        syncedAt,
      });
      return {
        ...item,
        tradingHours: basic.tradingHours,
      };
    });
    futuresBasicsRepository.upsertMany(enrichedItems.map((item) => buildFuturesBasicItem({
      quoteCode: item.quoteCode,
      code: item.quoteCode,
      name: item.name,
      exchange: item.exchange,
      source: item.source,
      syncedAt,
    })));

    futuresPresetCache.items = enrichedItems;
    futuresPresetCache.updatedAt = now;

    return {
      items: enrichedItems,
      total: enrichedItems.length,
      cached: false,
      updatedAt: syncedAt,
      dataSource: {
        universal: universalResult.status === 'fulfilled' ? 'eastmoney.searchapi' : null,
        domestic: domesticResult.status === 'fulfilled' ? 'eastmoney.globalfuture.js' : null,
      },
    };
  },

  listCategories() {
    const categories = futuresRepository.listCategories();
    const symbols = futuresRepository.listSymbols({ onlyActive: false });
    const basicsMap = new Map(
      futuresBasicsRepository.findByQuoteCodes(symbols.map((item) => item.quoteCode)).map((item) => [item.quoteCode, item]),
    );
    const enrichedSymbols = symbols.map((symbol) => {
      const basic = basicsMap.get(String(symbol.quoteCode || '').trim().toUpperCase());
      return {
        ...symbol,
        tradingHours: basic?.tradingHours || getOfficialFuturesTradingHours(symbol),
        exchange: basic?.exchange || null,
      };
    });
    return groupSymbolsByCategory(categories, enrichedSymbols);
  },

  createCategory(payload = {}) {
    const name = String(payload.name || '').trim();
    const description = String(payload.description || '').trim();
    const sortOrder = Number(payload.sortOrder || 100);
    const isEnabled = toBool(payload.isEnabled, true);

    if (!name) {
      throw new HttpError(400, '分类名称不能为空');
    }

    try {
      return futuresRepository.createCategory({
        name,
        description,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 100,
        isEnabled,
      });
    } catch (error) {
      if (String(error.message || '').includes('UNIQUE')) {
        throw new HttpError(409, `分类已存在: ${name}`);
      }
      throw error;
    }
  },

  updateCategory(categoryId, payload = {}) {
    const id = Number(categoryId);
    if (!Number.isFinite(id) || id <= 0) {
      throw new HttpError(400, 'categoryId 非法');
    }

    const existing = futuresRepository.getCategoryById(id);
    if (!existing) {
      throw new HttpError(404, `分类不存在: ${id}`);
    }

    const hasName = Object.prototype.hasOwnProperty.call(payload, 'name');
    const hasDescription = Object.prototype.hasOwnProperty.call(payload, 'description');
    const hasSortOrder = Object.prototype.hasOwnProperty.call(payload, 'sortOrder');
    const hasEnabled = Object.prototype.hasOwnProperty.call(payload, 'isEnabled');

    const name = String(hasName ? payload.name : (existing.name || '')).trim();
    const rawDescription = hasDescription ? payload.description : existing.description;
    const description = String(rawDescription || '').trim();
    const sortOrder = Number(hasSortOrder ? payload.sortOrder : (existing.sortOrder ?? 100));
    const isEnabled = toBool(hasEnabled ? payload.isEnabled : existing.isEnabled, existing.isEnabled !== false);

    if (!name) {
      throw new HttpError(400, '分类名称不能为空');
    }

    try {
      return futuresRepository.updateCategory(id, {
        name,
        description,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 100,
        isEnabled,
      });
    } catch (error) {
      if (String(error.message || '').includes('UNIQUE')) {
        throw new HttpError(409, `分类已存在: ${name}`);
      }
      throw error;
    }
  },

  deleteCategory(categoryId) {
    const id = Number(categoryId);
    if (!Number.isFinite(id) || id <= 0) {
      throw new HttpError(400, 'categoryId 非法');
    }

    const existing = futuresRepository.getCategoryById(id);
    if (!existing) {
      throw new HttpError(404, `分类不存在: ${id}`);
    }

    const symbolCount = futuresRepository.listSymbols({
      categoryId: id,
      onlyActive: false,
    }).length;
    futuresRepository.deleteCategory(id);
    return {
      ...existing,
      symbolCount,
    };
  },

  async createSymbol(payload = {}) {
    const categoryId = Number(payload.categoryId);
    if (!Number.isFinite(categoryId) || categoryId <= 0) {
      throw new HttpError(400, 'categoryId 非法');
    }

    const category = futuresRepository.getCategoryById(categoryId);
    if (!category) {
      throw new HttpError(404, `分类不存在: ${categoryId}`);
    }

    const normalized = await resolveQuoteCode(payload.quoteCode, {
      nameHint: payload.name,
    });
    const name = String(payload.name || '').trim() || normalized.code;
    const sortOrder = Number(payload.sortOrder || 100);

    try {
      const created = futuresRepository.createSymbol({
        categoryId,
        name,
        quoteCode: normalized.quoteCode,
        market: normalized.market,
        code: normalized.code,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 100,
        isActive: payload.isActive !== false,
      });
      futuresBasicsRepository.upsertOne(buildFuturesBasicItem({
        quoteCode: normalized.quoteCode,
        market: normalized.market,
        code: normalized.code,
        name,
        exchange: payload.exchange || '',
        source: 'futures.createSymbol',
        syncedAt: nowLocalDateTime(),
      }));
      return {
        ...created,
        tradingHours: getOfficialFuturesTradingHours(normalized),
      };
    } catch (error) {
      if (String(error.message || '').includes('UNIQUE')) {
        throw new HttpError(409, `该分类下品种已存在: ${normalized.quoteCode}`);
      }
      throw error;
    }
  },

  deleteSymbol(symbolId) {
    const id = Number(symbolId);
    if (!Number.isFinite(id) || id <= 0) {
      throw new HttpError(400, 'symbolId 非法');
    }

    const existing = futuresRepository.getSymbolById(id);
    if (!existing) {
      throw new HttpError(404, `品种不存在: ${id}`);
    }

    futuresRepository.deleteSymbol(id);
    return existing;
  },

  async getMonitor(payload = {}) {
    const categoryId = payload.categoryId ? Number(payload.categoryId) : null;
    const quoteCodes = parseMonitorQuoteCodes(payload.quoteCode);
    const quoteCodeSet = quoteCodes.length ? new Set(quoteCodes) : null;
    const timeframe = String(payload.timeframe || '30s');
    const hasExplicitLimit = payload.limit !== undefined && payload.limit !== null && payload.limit !== '';
    const defaultLimit = FUTURES_MONITOR_DEFAULT_LIMIT_MAP[timeframe]
      || (FUTURES_LONG_KLINE_KEYS.has(timeframe) ? 100 : 120);
    const parsedLimit = Number(hasExplicitLimit ? payload.limit : defaultLimit);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : defaultLimit;

    if (!FUTURES_TIMEFRAME_MAP[timeframe]) {
      throw new HttpError(400, `不支持的时间粒度: ${timeframe}`);
    }

    const categories = this.listCategories();
    const scopedCategories = categoryId
      ? categories.filter((item) => item.id === categoryId)
      : categories;

    if (categoryId && !scopedCategories.length) {
      throw new HttpError(404, `分类不存在: ${categoryId}`);
    }

    const activeCategories = scopedCategories.filter((item) => item.isEnabled !== false);

    let symbols = activeCategories.flatMap((item) => item.symbols || []).filter((item) => item.isActive !== false);
    if (quoteCodeSet) {
      symbols = symbols.filter((item) => {
        const key = normalizeMonitorQuoteCodeToken(item.quoteCode || `${item.market}.${item.code}`);
        if (quoteCodeSet.has(key)) return true;
        try {
          const normalized = normalizeQuoteCode(item.quoteCode || `${item.market}.${item.code}`);
          return quoteCodeSet.has(String(normalized.code || '').toUpperCase());
        } catch {
          return false;
        }
      });
    }
    if (!symbols.length) {
      return {
        timeframe,
        timeframeLabel: FUTURES_TIMEFRAME_MAP[timeframe].label,
        total: 0,
        success: 0,
        failed: 0,
        categories: activeCategories,
        quoteCodes,
        items: [],
      };
    }

    const categoryMap = new Map(activeCategories.map((item) => [item.id, item]));

    const items = await Promise.all(symbols.map(async (symbol) => {
      const normalized = normalizeQuoteCode(symbol.quoteCode || `${symbol.market}.${symbol.code}`);
      const category = categoryMap.get(symbol.categoryId);
      const quotePromise = fetchRealtimeQuote(normalized)
        .then((data) => ({ ok: true, data }))
        .catch((error) => ({ ok: false, error }));
      const isLongTimeframe = FUTURES_LONG_KLINE_KEYS.has(timeframe);
      const rawCandlesResult = isLongTimeframe
        ? { ok: false, error: new Error('long-local-first') }
        : await fetchCandlesWithFallback(normalized, { timeframe, limit })
          .then((data) => ({ ok: true, data }))
          .catch((error) => ({ ok: false, error }));
      const quoteResult = await quotePromise;
      let candlesResult = rawCandlesResult;
      let finalQuote = quoteResult.ok ? quoteResult.data : null;

      const warningList = [];
      const errorList = [];
      const quoteErrorText = quoteResult.ok ? '' : `实时行情失败: ${quoteResult.error?.message || '未知错误'}`;

      if (timeframe === '1m') {
        if (candlesResult.ok) {
          const mergedCandles = mergeAndPersistIntradayCandles({
            quoteCode: normalized.quoteCode,
            timeframe,
            limit,
            candles: candlesResult.data.candles || [],
            source: candlesResult.data.candleDataSource || null,
          });
          candlesResult = {
            ...candlesResult,
            data: {
              ...candlesResult.data,
              candles: mergedCandles,
              candleDataSource: candlesResult.data.candleDataSource === LOCAL_INTRADAY_DATA_SOURCE
                ? LOCAL_INTRADAY_DATA_SOURCE
                : `${candlesResult.data.candleDataSource || 'unknown'}+${LOCAL_INTRADAY_DATA_SOURCE}`,
            },
          };
        } else {
          const cachedCandles = loadIntradayCandlesFromStore({
            quoteCode: normalized.quoteCode,
            timeframe,
            limit,
          });
          if (cachedCandles.length) {
            candlesResult = {
              ok: true,
              data: {
                candles: cachedCandles,
                candleDataSource: LOCAL_INTRADAY_DATA_SOURCE,
                degraded: true,
                warning: `K线接口不可用，已回退本地缓存: ${rawCandlesResult.error?.message || '未知错误'}`,
              },
            };
          }
        }
      } else if (FUTURES_LONG_KLINE_KEYS.has(timeframe)) {
        let localCandles = loadLongCandlesFromStore({
          quoteCode: normalized.quoteCode,
          timeframe,
          limit,
        });
        const currentDerived = buildCurrentLongCandleFromMinuteStore({
          quoteCode: normalized.quoteCode,
          timeframe,
        });
        if (currentDerived) {
          localCandles = mergeAndPersistLongCandles({
            quoteCode: normalized.quoteCode,
            timeframe,
            limit,
            candles: [currentDerived],
            source: LOCAL_DERIVED_INTRADAY_SOURCE,
          });
        }

        const cacheComplete = isLongCacheComplete(localCandles, timeframe, limit);
        if (!cacheComplete) {
          triggerLongKlineBackgroundSync({
            normalized,
            timeframe,
            limit,
          });
        }

        if (localCandles.length) {
          candlesResult = {
            ok: true,
            data: {
              candles: localCandles,
              candleDataSource: LOCAL_INTRADAY_DATA_SOURCE,
              degraded: !cacheComplete,
              warning: cacheComplete ? null : 'K线优先展示本地缓存，后台正在补齐远程数据',
            },
          };
        } else {
          triggerLongKlineBackgroundSync({
            normalized,
            timeframe,
            limit,
          });
          candlesResult = {
            ok: false,
            error: new Error('本地暂无K线缓存，后台已启动补齐任务'),
          };
        }
      }

      if (!candlesResult.ok) {
        if (candlesResult.error?.message !== 'long-local-first') {
          logFuturesMonitorIssue({
            level: 'error',
            stage: 'candles-final-failed',
            symbol: normalized,
            timeframe,
            limit,
            error: candlesResult.error,
          });
        }
        errorList.push(`K线失败: ${candlesResult.error?.message || '未知错误'}`);
      } else if (candlesResult.data.warning) {
        warningList.push(candlesResult.data.warning);
      }

      if (!finalQuote && candlesResult.ok) {
        const fallbackQuote = buildQuoteFallbackFromCandles(normalized, candlesResult.data.candles || []);
        if (fallbackQuote) {
          finalQuote = fallbackQuote;
          if (quoteErrorText) {
            warningList.push(`实时行情不可用，已使用本地K线末值估算: ${quoteResult.error?.message || '未知错误'}`);
          }
        }
      }

      if (!finalQuote && quoteErrorText) {
        logFuturesMonitorIssue({
          level: 'error',
          stage: 'quote-final-failed',
          symbol: normalized,
          timeframe,
          limit,
          error: quoteResult.error,
        });
        errorList.push(quoteErrorText);
      } else if (!quoteResult.ok && finalQuote) {
        logFuturesMonitorIssue({
          level: 'warn',
          stage: 'quote-failed-fallback-used',
          symbol: normalized,
          timeframe,
          limit,
          error: quoteResult.error,
          extra: { quoteDataSource: finalQuote?.dataSource || null },
        });
      }

      return {
        id: symbol.id,
        categoryId: symbol.categoryId,
        categoryName: category?.name || '-',
        name: symbol.name,
        quoteCode: normalized.quoteCode,
        market: normalized.market,
        code: normalized.code,
        tradingHours: symbol.tradingHours || getOfficialFuturesTradingHours(normalized),
        timeframe,
        timeframeLabel: FUTURES_TIMEFRAME_MAP[timeframe].label,
        quote: finalQuote,
        candles: candlesResult.ok ? candlesResult.data.candles : [],
        candleDataSource: candlesResult.ok ? candlesResult.data.candleDataSource : null,
        warning: warningList.length ? warningList.join(' | ') : null,
        error: errorList.length ? errorList.join(' | ') : null,
      };
    }));

    const success = items.filter((item) => !item.error).length;
    const failed = items.length - success;

    return {
      timeframe,
      timeframeLabel: FUTURES_TIMEFRAME_MAP[timeframe].label,
      total: items.length,
      success,
      failed,
      categories: activeCategories,
      quoteCodes,
      items,
      fetchedAt: nowLocalDateTime(),
      failOpen: true,
    };
  },
};

import { HttpError } from '../utils/httpError.js';
import { inferMarket, normalizeStockCode, toYahooSymbol } from '../utils/stockCode.js';
import { stockBasicsRepository } from '../repositories/stockBasicsRepository.js';
import { stockMonitorRepository } from '../repositories/stockMonitorRepository.js';
import { stockDataService } from './stockDataService.js';
import { futuresService } from './futuresService.js';
import { nowLocalDateTime, toLocalDateTime } from '../utils/date.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getOfficialFuturesTradingHours, getOfficialStockTradingHours } from '../utils/tradingHours.js';

const execFileAsync = promisify(execFile);

const STOCK_MONITOR_TIMEFRAME_MAP = {
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
const STOCK_MONITOR_LONG_KLINE_KEYS = new Set(['1d', '1w', '1M']);
const STOCK_MONITOR_INTRADAY_INTERVAL_MINUTES = {
  '30s': 0.5,
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '60m': 60,
};
const STOCK_MONITOR_DEFAULT_LIMIT_MAP = {
  '1m': 1800,
};

function formatDateLocal(ts, withTime = false) {
  const d = new Date(ts * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  if (!withTime) return `${y}-${m}-${day}`;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function parseDateTimeToMs(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = text.includes('T')
    ? text
    : text.replace(' ', 'T');
  const ms = new Date(normalized).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function formatDateTimeFromMs(ms, withTime = true) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  if (!withTime) return `${y}-${m}-${day}`;

  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

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
  } else if (
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

function decodeGbkPayload(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  try {
    return new TextDecoder('gbk').decode(source);
  } catch {
    return source.toString('utf8');
  }
}

function toTencentStockSymbol(stockCode) {
  const normalized = normalizeStockCode(stockCode);
  const shMatch = normalized.match(/^SH(\d{6})$/);
  if (shMatch) return `sh${shMatch[1]}`;
  const szMatch = normalized.match(/^SZ(\d{6})$/);
  if (szMatch) return `sz${szMatch[1]}`;
  const market = inferMarket(normalized);
  if (market === 'CN_SH') return `sh${normalized}`;
  if (market === 'CN_SZ') return `sz${normalized}`;
  return '';
}

function formatTencentMinuteTime(value) {
  const text = String(value || '').trim();
  if (!/^\d{12}$/.test(text)) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)} ${text.slice(8, 10)}:${text.slice(10, 12)}:00`;
}

async function requestBufferByCurl(url, { referer = '', timeoutMs = 8000 } = {}) {
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
        return await requestBufferByCurlOnce(url, {
          referer,
          timeoutMs,
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
  const message = String(error?.stderr || error?.message || '').toLowerCase();
  return (
    message.includes('could not resolve host')
    || message.includes('empty reply from server')
    || message.includes('failed to connect')
    || message.includes('timed out')
    || message.includes('connection reset')
    || message.includes('tls')
    || message.includes('ssl')
  );
}

async function requestBufferByCurlOnce(url, { referer = '', timeoutMs = 8000, proxyUrl = '' } = {}) {
  const seconds = Math.max(3, Math.min(20, Math.ceil(Number(timeoutMs) / 1000)));
  const args = [
    '-sS',
    '--compressed',
    '--max-time',
    String(seconds),
    '-H',
    'User-Agent: Mozilla/5.0 (peng-stock-analysis stock-monitor tencent curl)',
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

function logStockMonitorIssue({
  level = 'error',
  stage = 'unknown',
  symbol = null,
  timeframe = '',
  limit = null,
  error = null,
  extra = null,
} = {}) {
  const logger = level === 'warn' ? console.warn : console.error;
  logger('[stock-monitor]', {
    at: nowLocalDateTime(),
    level,
    stage,
    stockCode: symbol?.stockCode || null,
    name: symbol?.name || null,
    market: symbol?.market || null,
    timeframe: timeframe || null,
    limit: Number.isFinite(Number(limit)) ? Number(limit) : null,
    errorName: error?.name || null,
    errorCode: error?.code || null,
    errorStatus: error?.status || null,
    errorMessage: error?.message || (error ? String(error) : null),
    extra: extra || undefined,
  });

  const shouldPrintTrace = Boolean(
    error?.stack
    && (level === 'error' || /failed|error/i.test(String(stage || ''))),
  );
  if (shouldPrintTrace) {
    logger('[stock-monitor][trace]', error.stack);
  }
}

async function requestYahooIntraday(stockCode, limit = 120) {
  const symbol = toYahooSymbol(normalizeStockCode(stockCode));
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set('range', '1d');
  url.searchParams.set('interval', '1m');
  url.searchParams.set('includePrePost', 'false');

  let response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (peng-stock-analysis stock-monitor)',
      },
    });
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('fetch failed')) {
      console.error('[stock-monitor-fetch-failed]', {
        at: nowLocalDateTime(),
        stage: 'requestYahooIntraday',
        stockCode: normalizeStockCode(stockCode),
        remoteUrl: url.toString(),
        errorMessage: message,
      });
      if (error?.stack) {
        console.error('[stock-monitor-fetch-failed][trace]', error.stack);
      }
    }
    throw error;
  }
  if (!response.ok) {
    throw new HttpError(response.status, `分钟数据请求失败: ${response.status}`);
  }

  const json = await response.json();
  const result = json?.chart?.result?.[0];
  const error = json?.chart?.error;
  if (error) {
    throw new HttpError(502, `分钟数据接口异常: ${error.description || error.code}`);
  }
  if (!result) {
    throw new HttpError(404, '分钟数据为空');
  }

  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];
  const volumes = quote.volume || [];

  const rows = timestamps
    .map((ts, idx) => {
      const close = toNum(closes[idx]);
      if (close == null || close <= 0) return null;
      const open = toNum(opens[idx]) ?? close;
      const high = toNum(highs[idx]) ?? Math.max(open, close);
      const low = toNum(lows[idx]) ?? Math.min(open, close);
      return {
        date: formatDateLocal(ts, true),
        open,
        high,
        low,
        close,
        volume: toNum(volumes[idx]) ?? 0,
        amount: 0,
      };
    })
    .filter(Boolean);

  if (!rows.length) {
    throw new HttpError(404, '分钟数据为空');
  }

  return {
    candles: rows.slice(-Math.max(Number(limit) || 120, 20)),
    candleDataSource: 'yahoo.chart.1m',
    warning: null,
  };
}

async function requestTencentIntraday(stockCode, limit = 120) {
  const normalized = normalizeStockCode(stockCode);
  const symbol = toTencentStockSymbol(normalized);
  if (!symbol) {
    throw new HttpError(400, '腾讯分钟线备用源仅支持A股代码');
  }

  const normalizedLimit = Math.max(Number(limit) || 120, 20);
  const url = new URL('https://ifzq.gtimg.cn/appstock/app/kline/mkline');
  url.searchParams.set('param', `${symbol},m1,,${normalizedLimit}`);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (peng-stock-analysis stock-monitor tencent)',
        Referer: 'https://gu.qq.com/',
      },
    });
    if (!response.ok) {
      throw new HttpError(response.status, `腾讯分钟数据请求失败: ${response.status}`);
    }

    const text = decodeGbkPayload(Buffer.from(await response.arrayBuffer()));
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new HttpError(502, '腾讯分钟数据格式异常');
    }

    const rows = payload?.data?.[symbol]?.m1 || [];
    const candles = rows
      .map((item) => {
        const date = formatTencentMinuteTime(item?.[0]);
        const close = toNum(item?.[2]);
        if (!date || close == null || close <= 0) return null;
        const open = toNum(item?.[1]) ?? close;
        const high = toNum(item?.[3]) ?? Math.max(open, close);
        const low = toNum(item?.[4]) ?? Math.min(open, close);
        return {
          date,
          open,
          high,
          low,
          close,
          volume: toNum(item?.[5]) ?? 0,
          amount: 0,
        };
      })
      .filter(Boolean);

    if (!candles.length) {
      throw new HttpError(404, '腾讯分钟数据为空');
    }

    return {
      candles: candles.slice(-normalizedLimit),
      candleDataSource: 'tencent.ifzq.m1',
      warning: '分钟数据已切换腾讯备用源',
    };
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('fetch failed')) {
      console.error('[stock-monitor-fetch-failed]', {
        at: nowLocalDateTime(),
        stage: 'requestTencentIntraday',
        stockCode: normalized,
        remoteUrl: url.toString(),
        errorMessage: message,
      });
      if (error?.stack) {
        console.error('[stock-monitor-fetch-failed][trace]', error.stack);
      }
    }

    if (error instanceof HttpError && !message.includes('fetch failed')) {
      throw error;
    }

    try {
      const buffer = await requestBufferByCurl(url.toString(), {
        referer: 'https://gu.qq.com/',
        timeoutMs: 8000,
      });
      const text = decodeGbkPayload(buffer);
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new HttpError(502, '腾讯分钟数据格式异常');
      }

      const rows = payload?.data?.[symbol]?.m1 || [];
      const candles = rows
        .map((item) => {
          const date = formatTencentMinuteTime(item?.[0]);
          const close = toNum(item?.[2]);
          if (!date || close == null || close <= 0) return null;
          const open = toNum(item?.[1]) ?? close;
          const high = toNum(item?.[3]) ?? Math.max(open, close);
          const low = toNum(item?.[4]) ?? Math.min(open, close);
          return {
            date,
            open,
            high,
            low,
            close,
            volume: toNum(item?.[5]) ?? 0,
            amount: 0,
          };
        })
        .filter(Boolean);

      if (!candles.length) {
        throw new HttpError(404, '腾讯分钟数据为空');
      }

      return {
        candles: candles.slice(-normalizedLimit),
        candleDataSource: 'tencent.ifzq.m1',
        warning: '分钟数据已切换腾讯备用源',
      };
    } catch (curlError) {
      console.error('[stock-monitor-fetch-failed][curl]', {
        at: nowLocalDateTime(),
        stage: 'requestTencentIntraday',
        stockCode: normalized,
        remoteUrl: url.toString(),
        errorMessage: String(curlError?.message || ''),
      });
      if (curlError?.stack) {
        console.error('[stock-monitor-fetch-failed][curl-trace]', curlError.stack);
      }
      throw curlError;
    }
  }
}

function aggregateByWeekOrMonth(rows = [], mode = 'week') {
  const sorted = [...rows]
    .filter((item) => item?.date && Number.isFinite(Number(item.close)))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const buckets = new Map();
  sorted.forEach((item) => {
    const d = new Date(`${item.date}T00:00:00`);
    if (Number.isNaN(d.getTime())) return;

    let key = '';
    if (mode === 'month') {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    } else {
      const monday = new Date(d);
      const day = monday.getDay() || 7;
      monday.setDate(monday.getDate() - day + 1);
      key = `W-${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
    }

    const current = buckets.get(key);
    if (!current) {
      buckets.set(key, {
        date: item.date,
        open: Number(item.open),
        high: Number(item.high),
        low: Number(item.low),
        close: Number(item.close),
        volume: Number(item.volume || 0),
        amount: Number(item.amount || 0),
      });
      return;
    }

    current.high = Math.max(current.high, Number(item.high || current.high));
    current.low = Math.min(current.low, Number(item.low || current.low));
    current.close = Number(item.close || current.close);
    current.date = item.date;
    current.volume += Number(item.volume || 0);
    current.amount += Number(item.amount || 0);
  });

  return Array.from(buckets.values())
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function aggregateIntradayByMinutes(rows = [], intervalMinutes = 1) {
  const spanMs = Math.max(1, Number(intervalMinutes) || 1) * 60 * 1000;
  const sorted = [...rows]
    .filter((item) => item?.date && Number.isFinite(Number(item.close)))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const buckets = new Map();
  sorted.forEach((item) => {
    const ts = parseDateTimeToMs(item.date);
    if (!Number.isFinite(ts)) return;

    const bucketTs = Math.floor(ts / spanMs) * spanMs;
    const key = String(bucketTs);
    const close = toNum(item.close);
    if (close == null) return;

    const open = toNum(item.open) ?? close;
    const high = toNum(item.high) ?? Math.max(open, close);
    const low = toNum(item.low) ?? Math.min(open, close);
    const volume = toNum(item.volume) ?? 0;
    const amount = toNum(item.amount) ?? 0;
    const date = formatDateTimeFromMs(bucketTs, true) || String(item.date);

    const current = buckets.get(key);
    if (!current) {
      buckets.set(key, {
        _ts: bucketTs,
        date,
        open,
        high,
        low,
        close,
        volume,
        amount,
      });
      return;
    }

    current.high = Math.max(current.high, high);
    current.low = Math.min(current.low, low);
    current.close = close;
    current.volume += volume;
    current.amount += amount;
  });

  return Array.from(buckets.values())
    .sort((a, b) => a._ts - b._ts)
    .map(({ _ts, ...item }) => item);
}

function joinWarningText(base = '', extra = '') {
  const textA = String(base || '').trim();
  const textB = String(extra || '').trim();
  if (!textA) return textB || null;
  if (!textB) return textA || null;
  return `${textA} | ${textB}`;
}

function normalizeMonitorStockCodeToken(input) {
  const text = String(input || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (!text) return '';
  const prefixed = text.match(/^(A|CN|US|HK)\.(.+)$/);
  if (prefixed) {
    const normalizedPrefixed = normalizeStockCode(prefixed[2]);
    if (normalizedPrefixed) return normalizedPrefixed;
  }
  const normalized = normalizeStockCode(text);
  if (normalized) return normalized;
  return text.replace(/[._-]/g, '.');
}

function parseMonitorStockCodes(input) {
  if (input === undefined || input === null || input === '') return [];
  const values = Array.isArray(input) ? input : [input];
  const tokens = values
    .flatMap((item) => String(item || '').split(/[\s,;|]+/))
    .map((item) => normalizeMonitorStockCodeToken(item))
    .filter(Boolean);
  return Array.from(new Set(tokens));
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
    stockCode: symbol.stockCode,
    stockName: symbol.name || symbol.stockCode,
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
    tradeTime: toLocalDateTime(last?.date, null),
    dataSource: 'local.candles.fallback',
    fetchedAt: nowLocalDateTime(),
  };
}

async function fetchStockIntraday1mSeries(stockCode, limit = 120) {
  const normalizedLimit = Math.max(Number(limit) || 120, 20);
  try {
    return await requestYahooIntraday(stockCode, normalizedLimit);
  } catch (yahooError) {
    const market = inferMarket(normalizeStockCode(stockCode));
    if (market === 'CN_SH' || market === 'CN_SZ') {
      try {
        return await requestTencentIntraday(stockCode, normalizedLimit);
      } catch {}

      try {
        const xtick = await stockDataService.getXTickIntraday(stockCode, { limit: normalizedLimit });
        return {
          candles: xtick.candles,
          candleDataSource: xtick.candleDataSource,
          warning: '分钟数据已切换XTick备用源',
        };
      } catch {}
    }

    const fallback = await stockDataService.getHistory(stockCode, { days: Math.max(normalizedLimit, 120) });
    const candles = (fallback?.history || [])
      .map((item) => ({
        date: item.date,
        open: Number(item.open || item.close || 0),
        high: Number(item.high || item.close || 0),
        low: Number(item.low || item.close || 0),
        close: Number(item.close || 0),
        volume: Number(item.volume || 0),
        amount: 0,
      }))
      .filter((item) => Number.isFinite(item.close) && item.close > 0)
      .slice(-normalizedLimit);

    if (!candles.length) {
      throw yahooError;
    }

    return {
      candles,
      candleDataSource: `stockData.${fallback?.quote?.dataSource || 'fallback'}`,
      warning: `分钟数据不可用，已降级为历史线: ${yahooError.message}`,
    };
  }
}

async function getStockMonitorSeries(stockCode, timeframe = '1m', limit = 120) {
  const tf = String(timeframe || '1m');
  const normalizedLimit = Math.max(Number(limit) || 120, 20);
  if (Object.prototype.hasOwnProperty.call(STOCK_MONITOR_INTRADAY_INTERVAL_MINUTES, tf)) {
    if (tf === '1m') {
      return fetchStockIntraday1mSeries(stockCode, normalizedLimit);
    }

    if (tf === '30s') {
      const minuteSeries = await fetchStockIntraday1mSeries(stockCode, normalizedLimit);
      return {
        candles: (minuteSeries.candles || []).slice(-normalizedLimit),
        candleDataSource: `${minuteSeries.candleDataSource || 'unknown'}+alias.30s<-1m`,
        warning: joinWarningText(minuteSeries.warning, '30秒K线暂使用1分钟数据近似'),
      };
    }

    const minuteWindow = Math.max(
      normalizedLimit * Math.max(1, Math.ceil(Number(STOCK_MONITOR_INTRADAY_INTERVAL_MINUTES[tf]) || 1)),
      120,
    );
    const minuteSeries = await fetchStockIntraday1mSeries(stockCode, minuteWindow);
    const candles = aggregateIntradayByMinutes(
      minuteSeries.candles || [],
      Number(STOCK_MONITOR_INTRADAY_INTERVAL_MINUTES[tf]) || 1,
    );
    if (!candles.length) {
      throw new HttpError(404, `${tf} 数据为空`);
    }
    return {
      candles: candles.slice(-normalizedLimit),
      candleDataSource: `${minuteSeries.candleDataSource || 'unknown'}+agg.${tf}`,
      warning: minuteSeries.warning || null,
    };
  }

  const days = tf === '1M'
    ? Math.max(normalizedLimit * 40, 1200)
    : Math.max(normalizedLimit * 8, 500);
  const payload = await stockDataService.getHistory(stockCode, { days });
  const rows = payload?.history || [];
  if (!rows.length) {
    throw new HttpError(404, '历史数据为空');
  }

  let candles = rows.map((item) => ({
    date: item.date,
    open: Number(item.open || item.close || 0),
    high: Number(item.high || item.close || 0),
    low: Number(item.low || item.close || 0),
    close: Number(item.close || 0),
    volume: Number(item.volume || 0),
    amount: 0,
  }));

  if (tf === '1w') {
    candles = aggregateByWeekOrMonth(candles, 'week');
  } else if (tf === '1M') {
    candles = aggregateByWeekOrMonth(candles, 'month');
  }

  return {
    candles: candles.slice(-normalizedLimit),
    candleDataSource: `stockData.${payload?.quote?.dataSource || 'yahoo'}`,
    warning: null,
  };
}

function mapMonitorMarket(stockCode) {
  const market = inferMarket(stockCode);
  if (market.startsWith('CN_')) return 'A';
  if (market === 'HK') return 'HK';
  if (market === 'US' || market === 'US_INDEX') return 'US';
  return 'UNKNOWN';
}

function normalizeMonitorSymbolType(value = '', market = '') {
  const text = String(value || '').trim().toLowerCase();
  if (['futures', 'future', 'qh', '期货'].includes(text)) return 'futures';
  if (['stock', 'stocks', 'equity', '股票'].includes(text)) return 'stock';
  const marketText = String(market || '').trim().toUpperCase();
  if (marketText.startsWith('FUTURES')) return 'futures';
  return 'stock';
}

function isFuturesMonitorSymbol(symbol = {}) {
  return normalizeMonitorSymbolType(symbol.symbolType, symbol.market) === 'futures';
}

function normalizeFuturesQuoteToken(value = '') {
  const text = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!text) return '';
  const matched = text.match(/^(\d{2,3})[._-]?([A-Z0-9]+)$/);
  if (matched) {
    return `${matched[1]}.${matched[2]}`;
  }
  return text.replace(/_/g, '.');
}

function buildMonitorSymbolTokens(symbol = {}) {
  const tokens = new Set();
  const stockCode = String(symbol.stockCode || '').trim();
  if (!stockCode) return tokens;

  const normalized = normalizeMonitorStockCodeToken(stockCode);
  if (normalized) {
    tokens.add(normalized);
    tokens.add(normalized.replace(/[._-]/g, ''));
  }

  const marketToken = normalizeMonitorStockCodeToken(`${symbol.market || ''}.${stockCode}`);
  if (marketToken) tokens.add(marketToken);

  if (isFuturesMonitorSymbol(symbol)) {
    const futuresToken = normalizeFuturesQuoteToken(stockCode);
    if (futuresToken) {
      tokens.add(futuresToken);
      tokens.add(futuresToken.replace(/[._-]/g, ''));
      const match = futuresToken.match(/^(\d{2,3})\.([A-Z0-9]+)$/);
      if (match) {
        tokens.add(match[2]);
      }
    }
  }

  return tokens;
}

export const stockMonitorService = {
  getTimeframes() {
    return Object.entries(STOCK_MONITOR_TIMEFRAME_MAP).map(([key, item]) => ({
      key,
      label: item.label,
      code: item.code,
    }));
  },

  listCategories() {
    const categories = stockMonitorRepository.listCategories();
    const symbols = stockMonitorRepository.listSymbols();
    const grouped = new Map();
    symbols.forEach((item) => {
      if (!grouped.has(item.categoryId)) grouped.set(item.categoryId, []);
      grouped.get(item.categoryId).push(item);
    });

    return categories.map((category) => ({
      ...category,
      symbols: (grouped.get(category.id) || []).map((symbol) => {
        const symbolType = normalizeMonitorSymbolType(symbol.symbolType, symbol.market);
        if (symbolType === 'futures') {
          const quoteCode = normalizeFuturesQuoteToken(symbol.stockCode);
          const marketText = String(symbol.market || '').trim().toUpperCase();
          const matched = marketText.match(/^FUTURES_(\d{2,3})$/);
          const futuresMarket = matched ? Number(matched[1]) : null;
          return {
            ...symbol,
            symbolType: 'futures',
            quoteCode,
            tradingHours: getOfficialFuturesTradingHours({
              quoteCode,
              code: quoteCode,
              market: Number.isFinite(futuresMarket) ? futuresMarket : null,
            }) || null,
          };
        }

        const localBasic = stockBasicsRepository.findByMarketAndCode(symbol.market, symbol.stockCode);
        return {
          ...symbol,
          symbolType: 'stock',
          quoteCode: symbol.stockCode,
          tradingHours: getOfficialStockTradingHours({
            market: localBasic?.market || symbol.market,
            subMarket: localBasic?.subMarket || '',
          }) || null,
        };
      }),
    }));
  },

  createCategory(payload = {}) {
    const name = String(payload.name || '').trim();
    if (!name) throw new HttpError(400, '分类名称不能为空');
    return stockMonitorRepository.createCategory({
      name,
      description: String(payload.description || '').trim(),
      sortOrder: Number(payload.sortOrder || 100),
      isEnabled: toBool(payload.isEnabled, true),
    });
  },

  updateCategory(categoryId, payload = {}) {
    const id = Number(categoryId);
    if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, 'categoryId 非法');
    const existing = stockMonitorRepository.getCategoryById(id);
    if (!existing) throw new HttpError(404, `分类不存在: ${id}`);

    const hasName = Object.prototype.hasOwnProperty.call(payload, 'name');
    const hasDescription = Object.prototype.hasOwnProperty.call(payload, 'description');
    const hasSortOrder = Object.prototype.hasOwnProperty.call(payload, 'sortOrder');
    const hasEnabled = Object.prototype.hasOwnProperty.call(payload, 'isEnabled');

    const name = String(hasName ? payload.name : (existing.name || '')).trim();
    if (!name) throw new HttpError(400, '分类名称不能为空');

    const rawDescription = hasDescription ? payload.description : existing.description;
    const description = String(rawDescription || '').trim();
    const sortOrder = Number(hasSortOrder ? payload.sortOrder : (existing.sortOrder || 100));
    const isEnabled = toBool(hasEnabled ? payload.isEnabled : existing.isEnabled, existing.isEnabled !== false);

    return stockMonitorRepository.updateCategory(id, {
      name,
      description,
      sortOrder,
      isEnabled,
    });
  },

  deleteCategory(categoryId) {
    const id = Number(categoryId);
    if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, 'categoryId 非法');
    const existing = stockMonitorRepository.getCategoryById(id);
    if (!existing) throw new HttpError(404, `分类不存在: ${id}`);
    stockMonitorRepository.deleteCategory(id);
    return existing;
  },

  moveCategory(categoryId, payload = {}) {
    const id = Number(categoryId);
    if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, 'categoryId 非法');

    const existing = stockMonitorRepository.getCategoryById(id);
    if (!existing) throw new HttpError(404, `分类不存在: ${id}`);

    const direction = String(payload?.direction || payload?.move || '').trim().toLowerCase();
    if (!['up', 'down'].includes(direction)) {
      throw new HttpError(400, 'direction 非法，仅支持 up/down');
    }

    const categories = stockMonitorRepository.listCategories();
    const currentIndex = categories.findIndex((item) => item.id === id);
    if (currentIndex < 0) {
      throw new HttpError(404, `分类不存在: ${id}`);
    }

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= categories.length) {
      return {
        moved: false,
        direction,
        item: existing,
      };
    }

    const reordered = [...categories];
    [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
    stockMonitorRepository.reorderCategories(reordered.map((item) => item.id));

    return {
      moved: true,
      direction,
      item: stockMonitorRepository.getCategoryById(id),
    };
  },

  async createSymbol(payload = {}) {
    const categoryId = Number(payload.categoryId);
    const symbolType = normalizeMonitorSymbolType(
      payload.symbolType || payload.type || payload.assetType,
      payload.market,
    );
    if (!Number.isFinite(categoryId) || categoryId <= 0) {
      throw new HttpError(400, 'categoryId 非法');
    }
    const category = stockMonitorRepository.getCategoryById(categoryId);
    if (!category) throw new HttpError(404, `分类不存在: ${categoryId}`);

    if (symbolType === 'futures') {
      const rawCode = String(payload.quoteCode || payload.stockCode || payload.code || '').trim();
      if (!rawCode) {
        throw new HttpError(400, '期货代码不能为空');
      }

      const normalized = await futuresService.resolveSymbol(rawCode, {
        nameHint: payload.name,
      });
      const quoteCode = normalizeFuturesQuoteToken(normalized?.quoteCode || rawCode);
      const market = `FUTURES_${normalized?.market || ''}`;
      const fallbackName = String(payload.name || normalized?.code || quoteCode).trim();

      try {
        const created = stockMonitorRepository.createSymbol({
          categoryId,
          name: fallbackName,
          stockCode: quoteCode,
          market,
          sortOrder: Number(payload.sortOrder || 100),
          isActive: payload.isActive !== false,
          symbolType: 'futures',
        });
        return {
          ...created,
          symbolType: 'futures',
          quoteCode,
          tradingHours: getOfficialFuturesTradingHours(normalized) || null,
        };
      } catch (error) {
        if (String(error.message || '').includes('UNIQUE')) {
          throw new HttpError(409, `该分类下标的已存在: ${quoteCode}`);
        }
        throw error;
      }
    }

    const stockCode = normalizeStockCode(payload.stockCode || payload.code || '');
    if (!stockCode) {
      throw new HttpError(400, '股票代码不能为空');
    }
    const market = mapMonitorMarket(stockCode);
    if (market === 'UNKNOWN') {
      throw new HttpError(400, `无法识别股票市场: ${stockCode}`);
    }
    const localBasic = stockBasicsRepository.findByMarketAndCode(market, stockCode);
    const name = String(payload.name || localBasic?.name || stockCode).trim();

    try {
      const created = stockMonitorRepository.createSymbol({
        categoryId,
        name,
        stockCode,
        market,
        sortOrder: Number(payload.sortOrder || 100),
        isActive: payload.isActive !== false,
        symbolType: 'stock',
      });
      return {
        ...created,
        symbolType: 'stock',
        quoteCode: stockCode,
      };
    } catch (error) {
      if (String(error.message || '').includes('UNIQUE')) {
        throw new HttpError(409, `该分类下标的已存在: ${stockCode}`);
      }
      throw error;
    }
  },

  deleteSymbol(symbolId) {
    const id = Number(symbolId);
    if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, 'symbolId 非法');
    const existing = stockMonitorRepository.getSymbolById(id);
    if (!existing) throw new HttpError(404, `标的不存在: ${id}`);
    stockMonitorRepository.deleteSymbol(id);
    return existing;
  },

  moveSymbol(symbolId, payload = {}) {
    const id = Number(symbolId);
    if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, 'symbolId 非法');

    const existing = stockMonitorRepository.getSymbolById(id);
    if (!existing) throw new HttpError(404, `标的不存在: ${id}`);

    const direction = String(payload?.direction || payload?.move || '').trim().toLowerCase();
    if (!['up', 'down'].includes(direction)) {
      throw new HttpError(400, 'direction 非法，仅支持 up/down');
    }

    const symbols = stockMonitorRepository.listSymbols({
      categoryId: existing.categoryId,
      onlyActive: false,
    });
    const currentIndex = symbols.findIndex((item) => item.id === id);
    if (currentIndex < 0) {
      throw new HttpError(404, `分类内不存在该标的: ${id}`);
    }

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= symbols.length) {
      return {
        moved: false,
        direction,
        item: existing,
      };
    }

    const reordered = [...symbols];
    [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];

    stockMonitorRepository.reorderCategorySymbols(
      existing.categoryId,
      reordered.map((item) => item.id),
    );

    return {
      moved: true,
      direction,
      item: stockMonitorRepository.getSymbolById(id),
    };
  },

  async getMonitor(payload = {}) {
    const categoryId = payload.categoryId ? Number(payload.categoryId) : null;
    const stockCodes = parseMonitorStockCodes([
      payload.stockCode,
      payload.quoteCode,
      payload.code,
    ]);
    const stockCodeSet = stockCodes.length ? new Set(stockCodes) : null;
    const timeframe = String(payload.timeframe || '30s');
    const hasExplicitLimit = payload.limit !== undefined && payload.limit !== null && payload.limit !== '';
    const defaultLimit = STOCK_MONITOR_DEFAULT_LIMIT_MAP[timeframe]
      || (STOCK_MONITOR_LONG_KLINE_KEYS.has(timeframe) ? 100 : 120);
    const parsedLimit = Number(hasExplicitLimit ? payload.limit : defaultLimit);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : defaultLimit;
    if (!STOCK_MONITOR_TIMEFRAME_MAP[timeframe]) {
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
    if (stockCodeSet) {
      symbols = symbols.filter((item) => {
        const tokens = buildMonitorSymbolTokens(item);
        return Array.from(tokens).some((token) => stockCodeSet.has(token));
      });
    }
    if (!symbols.length) {
      return {
        timeframe,
        timeframeLabel: STOCK_MONITOR_TIMEFRAME_MAP[timeframe].label,
        total: 0,
        success: 0,
        failed: 0,
        categories: activeCategories,
        quoteCodes: stockCodes,
        items: [],
      };
    }

    const categoryMap = new Map(activeCategories.map((item) => [item.id, item]));
    const stockSymbols = symbols.filter((item) => !isFuturesMonitorSymbol(item));
    const futuresSymbols = symbols.filter((item) => isFuturesMonitorSymbol(item));

    const stockItems = await Promise.all(stockSymbols.map(async (symbol) => {
      const quotePromise = stockDataService.getQuote(symbol.stockCode)
        .then((data) => ({ ok: true, data }))
        .catch((error) => ({ ok: false, error }));
      const candlesResult = await getStockMonitorSeries(symbol.stockCode, timeframe, limit)
        .then((data) => ({ ok: true, data }))
        .catch((error) => ({ ok: false, error }));
      const quoteResult = await quotePromise;

      const warningList = [];
      const errorList = [];
      let finalQuote = quoteResult.ok ? quoteResult.data : null;
      const quoteErrorText = quoteResult.ok ? '' : `实时行情失败: ${quoteResult.error?.message || '未知错误'}`;

      if (!candlesResult.ok) {
        logStockMonitorIssue({
          level: 'error',
          stage: 'candles-final-failed',
          symbol,
          timeframe,
          limit,
          error: candlesResult.error,
        });
        errorList.push(`K线失败: ${candlesResult.error?.message || '未知错误'}`);
      } else if (candlesResult.data.warning) {
        logStockMonitorIssue({
          level: 'warn',
          stage: 'candles-warning',
          symbol,
          timeframe,
          limit,
          error: new Error(candlesResult.data.warning),
          extra: { candleDataSource: candlesResult.data.candleDataSource || null },
        });
        warningList.push(candlesResult.data.warning);
      }

      if (!finalQuote && candlesResult.ok) {
        const fallbackQuote = buildQuoteFallbackFromCandles(symbol, candlesResult.data.candles || []);
        if (fallbackQuote) {
          finalQuote = fallbackQuote;
          if (quoteErrorText) {
            warningList.push(`实时行情不可用，已使用本地K线末值估算: ${quoteResult.error?.message || '未知错误'}`);
          }
        }
      }

      if (!finalQuote && quoteErrorText) {
        logStockMonitorIssue({
          level: 'error',
          stage: 'quote-final-failed',
          symbol,
          timeframe,
          limit,
          error: quoteResult.error,
        });
        errorList.push(quoteErrorText);
      } else if (!quoteResult.ok && finalQuote) {
        logStockMonitorIssue({
          level: 'warn',
          stage: 'quote-failed-fallback-used',
          symbol,
          timeframe,
          limit,
          error: quoteResult.error,
          extra: { quoteDataSource: finalQuote?.dataSource || null },
        });
      }

      const prevClose = Number(finalQuote?.prevClose || 0);
      const price = Number(finalQuote?.price || 0);
      const change = Number.isFinite(price) && Number.isFinite(prevClose)
        ? (price - prevClose)
        : null;

      return {
        id: symbol.id,
        categoryId: symbol.categoryId,
        categoryName: categoryMap.get(symbol.categoryId)?.name || '-',
        name: symbol.name,
        quoteCode: symbol.stockCode,
        stockCode: symbol.stockCode,
        market: symbol.market,
        code: symbol.stockCode,
        symbolType: 'stock',
        tradingHours: symbol.tradingHours || getOfficialStockTradingHours({
          market: symbol.market,
        }) || null,
        timeframe,
        timeframeLabel: STOCK_MONITOR_TIMEFRAME_MAP[timeframe].label,
        quote: finalQuote ? {
          ...finalQuote,
          tradeTime: toLocalDateTime(finalQuote.tradeTime, finalQuote.tradeTime || null),
          fetchedAt: toLocalDateTime(finalQuote.fetchedAt, nowLocalDateTime()),
          change,
          quoteCode: symbol.stockCode,
        } : null,
        candles: candlesResult.ok ? candlesResult.data.candles : [],
        candleDataSource: candlesResult.ok ? candlesResult.data.candleDataSource : null,
        warning: warningList.length ? warningList.join(' | ') : null,
        error: errorList.length ? errorList.join(' | ') : null,
      };
    }));

    let futuresItems = [];
    if (futuresSymbols.length) {
      const nameMap = Object.fromEntries(
        futuresSymbols.map((item) => [normalizeFuturesQuoteToken(item.stockCode), item.name]),
      );
      try {
        const futuresPayload = await futuresService.getMonitorByQuoteCodes({
          quoteCode: futuresSymbols.map((item) => normalizeFuturesQuoteToken(item.stockCode)),
          timeframe,
          limit,
          nameMap,
        });
        const futuresMap = new Map();
        (futuresPayload.items || []).forEach((item) => {
          const token = normalizeFuturesQuoteToken(item.quoteCode || item.code || '');
          if (!token) return;
          futuresMap.set(token, item);
          futuresMap.set(token.replace(/[._-]/g, ''), item);
          const matched = token.match(/^(\d{2,3})\.([A-Z0-9]+)$/);
          if (matched) {
            futuresMap.set(matched[2], item);
          }
        });

        futuresItems = futuresSymbols.map((symbol) => {
          const token = normalizeFuturesQuoteToken(symbol.stockCode);
          const source = futuresMap.get(token) || futuresMap.get(token.replace(/[._-]/g, '')) || null;
          const marketText = String(symbol.market || '').trim().toUpperCase();
          const marketMatched = marketText.match(/^FUTURES_(\d{2,3})$/);
          const futuresMarket = marketMatched ? Number(marketMatched[1]) : null;

          if (!source) {
            return {
              id: symbol.id,
              categoryId: symbol.categoryId,
              categoryName: categoryMap.get(symbol.categoryId)?.name || '-',
              name: symbol.name,
              quoteCode: token || symbol.stockCode,
              stockCode: token || symbol.stockCode,
              market: symbol.market,
              code: token || symbol.stockCode,
              symbolType: 'futures',
              tradingHours: symbol.tradingHours || getOfficialFuturesTradingHours({
                quoteCode: token || symbol.stockCode,
                code: token || symbol.stockCode,
                market: Number.isFinite(futuresMarket) ? futuresMarket : null,
              }) || null,
              timeframe,
              timeframeLabel: STOCK_MONITOR_TIMEFRAME_MAP[timeframe].label,
              quote: null,
              candles: [],
              candleDataSource: null,
              warning: null,
              error: `期货行情失败: 未获取到 ${token || symbol.stockCode} 的监测数据`,
            };
          }

          return {
            id: symbol.id,
            categoryId: symbol.categoryId,
            categoryName: categoryMap.get(symbol.categoryId)?.name || '-',
            name: symbol.name || source.name || source.code || token,
            quoteCode: source.quoteCode || token || symbol.stockCode,
            stockCode: source.quoteCode || token || symbol.stockCode,
            market: symbol.market,
            code: source.code || source.quoteCode || token || symbol.stockCode,
            symbolType: 'futures',
            tradingHours: symbol.tradingHours || source.tradingHours || getOfficialFuturesTradingHours({
              quoteCode: source.quoteCode || token || symbol.stockCode,
              code: source.code || source.quoteCode || token || symbol.stockCode,
              market: Number.isFinite(futuresMarket) ? futuresMarket : null,
            }) || null,
            timeframe,
            timeframeLabel: STOCK_MONITOR_TIMEFRAME_MAP[timeframe].label,
            quote: source.quote || null,
            candles: Array.isArray(source.candles) ? source.candles : [],
            candleDataSource: source.candleDataSource || null,
            warning: source.warning || null,
            error: source.error || null,
          };
        });
      } catch (error) {
        futuresItems = futuresSymbols.map((symbol) => ({
          id: symbol.id,
          categoryId: symbol.categoryId,
          categoryName: categoryMap.get(symbol.categoryId)?.name || '-',
          name: symbol.name,
          quoteCode: normalizeFuturesQuoteToken(symbol.stockCode) || symbol.stockCode,
          stockCode: normalizeFuturesQuoteToken(symbol.stockCode) || symbol.stockCode,
          market: symbol.market,
          code: normalizeFuturesQuoteToken(symbol.stockCode) || symbol.stockCode,
          symbolType: 'futures',
          tradingHours: symbol.tradingHours || null,
          timeframe,
          timeframeLabel: STOCK_MONITOR_TIMEFRAME_MAP[timeframe].label,
          quote: null,
          candles: [],
          candleDataSource: null,
          warning: null,
          error: `期货行情失败: ${error?.message || '未知错误'}`,
        }));
      }
    }

    const itemMap = new Map([...stockItems, ...futuresItems].map((item) => [item.id, item]));
    const items = symbols
      .map((symbol) => itemMap.get(symbol.id))
      .filter(Boolean);

    const success = items.filter((item) => !item.error).length;
    const failed = items.length - success;

    return {
      timeframe,
      timeframeLabel: STOCK_MONITOR_TIMEFRAME_MAP[timeframe].label,
      total: items.length,
      success,
      failed,
      categories: activeCategories,
      quoteCodes: stockCodes,
      items,
      fetchedAt: nowLocalDateTime(),
      failOpen: true,
    };
  },
};

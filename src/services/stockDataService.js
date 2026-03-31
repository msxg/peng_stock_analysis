import { inferMarket, normalizeStockCode, toYahooSymbol } from '../utils/stockCode.js';
import { movingAverage, pctChange, average } from '../utils/indicators.js';
import { HttpError } from '../utils/httpError.js';
import { nowLocalDateTime, toLocalDateTime } from '../utils/date.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { env } from '../config/env.js';

const execFileAsync = promisify(execFile);

function getRangeFromDays(days = 180) {
  if (days <= 30) return '1mo';
  if (days <= 90) return '3mo';
  if (days <= 180) return '6mo';
  if (days <= 365) return '1y';
  return '2y';
}

function parseChartPayload(json) {
  const result = json?.chart?.result?.[0];
  const error = json?.chart?.error;
  if (error) throw new HttpError(502, `行情接口异常: ${error.description || error.code}`);
  if (!result) throw new HttpError(404, '未查询到股票行情数据');

  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const volumes = quote.volume || [];

  const rows = timestamps
    .map((ts, idx) => ({
      ts,
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      open: Number(opens[idx] || 0),
      high: Number(highs[idx] || 0),
      low: Number(lows[idx] || 0),
      close: Number(closes[idx] || 0),
      volume: Number(volumes[idx] || 0),
    }))
    .filter((item) => Number.isFinite(item.close) && item.close > 0);

  return {
    meta: result.meta || {},
    rows,
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

function formatTencentQuoteTime(value) {
  const text = String(value || '').trim();
  if (!/^\d{14}$/.test(text)) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)} ${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}`;
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

function toCnCoreCode(stockCode) {
  const normalized = normalizeStockCode(stockCode);
  const match = normalized.match(/^(SH|SZ)(\d{6})$/);
  if (match) return match[2];
  return normalized;
}

function toXTickType(stockCode) {
  const normalized = normalizeStockCode(stockCode);
  const market = inferMarket(normalized);
  if (market === 'CN_SH' || market === 'CN_SZ') return 1;
  if (market === 'HK') return 3;
  return null;
}

function parseTencentRealtimeQuote(text = '', stockCode = '') {
  const matched = String(text || '').trim().match(/="([^"]*)"/);
  if (!matched) {
    throw new HttpError(502, '腾讯行情数据格式异常');
  }

  const parts = String(matched[1] || '').split('~');
  if (parts.length < 38) {
    throw new HttpError(502, '腾讯行情数据字段不足');
  }

  const normalized = normalizeStockCode(stockCode);
  const price = Number(parts[3] || 0);
  const prevClose = Number(parts[4] || 0);
  const open = Number(parts[5] || 0);
  const high = Number(parts[33] || 0);
  const low = Number(parts[34] || 0);
  const volume = Number(parts[36] || 0);
  const amount = Number(parts[37] || 0);
  const change = Number(parts[31] || (price - prevClose) || 0);
  const changePct = Number(parts[32] || 0);

  return {
    stockCode: normalized,
    symbol: toTencentStockSymbol(normalized),
    stockName: String(parts[1] || '').trim() || normalized,
    market: inferMarket(normalized),
    price: Number.isFinite(price) ? price : 0,
    open: Number.isFinite(open) ? open : 0,
    high: Number.isFinite(high) ? high : 0,
    low: Number.isFinite(low) ? low : 0,
    prevClose: Number.isFinite(prevClose) ? prevClose : 0,
    change: Number.isFinite(change) ? change : 0,
    changePct: Number.isFinite(changePct) ? changePct : 0,
    volume: Number.isFinite(volume) ? volume : 0,
    amount: Number.isFinite(amount) ? amount : 0,
    volumeRatio: 1,
    ma5: null,
    ma10: null,
    ma20: null,
    tradeTime: formatTencentQuoteTime(parts[30]),
    dataSource: 'tencent.qt',
    fetchedAt: nowLocalDateTime(),
  };
}

function unwrapXTickPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;

  const code = Number(payload?.code);
  if (Number.isFinite(code) && code !== 0) {
    throw new HttpError(502, `XTick接口异常: ${payload?.message || code}`);
  }
  if (payload?.data === null) {
    throw new HttpError(404, payload?.message || 'XTick 数据为空');
  }
  return [];
}

function buildXTickCandle(item = {}) {
  const close = Number(item?.close);
  if (!Number.isFinite(close) || close <= 0) return null;

  const open = Number(item?.open);
  const high = Number(item?.high);
  const low = Number(item?.low);
  return {
    date: toLocalDateTime(item?.time, null),
    open: Number.isFinite(open) ? open : close,
    high: Number.isFinite(high) ? high : Math.max(Number.isFinite(open) ? open : close, close),
    low: Number.isFinite(low) ? low : Math.min(Number.isFinite(open) ? open : close, close),
    close,
    volume: Number(item?.volume || 0),
    amount: Number(item?.amount || 0),
    prevClose: Number(item?.preClose || item?.lastClose || 0),
  };
}

async function requestXTickJson(pathname, params = {}, { stage = 'xtick-request', timeoutMs = 8000 } = {}) {
  if (!env.XTICK_TOKEN) {
    throw new HttpError(400, 'XTick token 未配置');
  }

  const baseUrl = String(env.XTICK_BASE_URL || 'http://api.xtick.top/').trim() || 'http://api.xtick.top/';
  const url = new URL(String(pathname || '').replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });
  url.searchParams.set('token', env.XTICK_TOKEN);

  let text = '';
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (peng-stock-analysis stock-data xtick)',
        Referer: 'http://www.xtick.top/apidoc',
      },
    });
    if (!response.ok) {
      throw new HttpError(response.status, `XTick请求失败: ${response.status}`);
    }
    text = await response.text();
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('fetch failed')) {
      console.error('[stock-data-fetch-failed]', {
        at: nowLocalDateTime(),
        stage,
        remoteUrl: url.toString(),
        errorMessage: message,
      });
      if (error?.stack) {
        console.error('[stock-data-fetch-failed][trace]', error.stack);
      }
    }

    if (error instanceof HttpError && !message.includes('fetch failed')) {
      throw error;
    }

    try {
      const buffer = await requestBufferByCurl(url.toString(), {
        referer: 'http://www.xtick.top/apidoc',
        timeoutMs,
      });
      text = buffer.toString('utf8');
    } catch (curlError) {
      console.error('[stock-data-fetch-failed][curl]', {
        at: nowLocalDateTime(),
        stage,
        remoteUrl: url.toString(),
        errorMessage: String(curlError?.message || ''),
      });
      if (curlError?.stack) {
        console.error('[stock-data-fetch-failed][curl-trace]', curlError.stack);
      }
      throw curlError;
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(502, 'XTick返回数据格式异常');
  }
}

async function requestXTickRealtimeQuote(stockCode) {
  const normalized = normalizeStockCode(stockCode);
  const coreCode = toCnCoreCode(normalized);
  const type = toXTickType(normalized);
  if (type !== 1) {
    throw new HttpError(400, 'XTick实时报价备用源当前仅支持A股代码');
  }

  const payload = await requestXTickJson('/doc/order/time', {
    type,
    code: coreCode,
    period: 'lv1',
  }, {
    stage: 'requestXTickRealtimeQuote',
  });
  const rows = unwrapXTickPayload(payload);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    throw new HttpError(404, 'XTick实时报价为空');
  }

  const price = Number(row?.lastPrice || 0);
  const prevClose = Number(row?.lastClose || 0);
  return {
    stockCode: normalized,
    symbol: normalized,
    stockName: normalized,
    market: inferMarket(normalized),
    price: Number.isFinite(price) ? price : 0,
    open: Number(row?.open || 0),
    high: Number(row?.high || 0),
    low: Number(row?.low || 0),
    prevClose: Number.isFinite(prevClose) ? prevClose : 0,
    change: Number.isFinite(price) && Number.isFinite(prevClose) ? (price - prevClose) : 0,
    changePct: Number.isFinite(price) && Number.isFinite(prevClose) && prevClose !== 0
      ? Number((((price - prevClose) / prevClose) * 100).toFixed(2))
      : 0,
    volume: Number(row?.volume || 0),
    amount: Number(row?.amount || 0),
    volumeRatio: 1,
    ma5: null,
    ma10: null,
    ma20: null,
    tradeTime: toLocalDateTime(row?.time, null),
    dataSource: 'xtick.order.lv1',
    fetchedAt: nowLocalDateTime(),
  };
}

async function requestXTickMinuteSeries(stockCode, { limit = 120, fq = 'none' } = {}) {
  const normalized = normalizeStockCode(stockCode);
  const coreCode = toCnCoreCode(normalized);
  const type = toXTickType(normalized);
  if (type !== 1) {
    throw new HttpError(400, 'XTick分钟线备用源当前仅支持A股代码');
  }

  const payload = await requestXTickJson('/doc/kline/minute', {
    type,
    code: coreCode,
    fq,
  }, {
    stage: 'requestXTickMinuteSeries',
    timeoutMs: 10000,
  });
  const rows = unwrapXTickPayload(payload);
  const candles = rows
    .map(buildXTickCandle)
    .filter((item) => item?.date && Number.isFinite(item.close) && item.close > 0);

  if (!candles.length) {
    throw new HttpError(404, 'XTick分钟线数据为空');
  }

  const normalizedLimit = Math.max(Number(limit) || 120, 20);
  return {
    candles: candles.slice(-normalizedLimit).map(({ prevClose, ...item }) => item),
    quoteSeed: candles[candles.length - 1] || null,
    candleDataSource: 'xtick.kline.minute',
  };
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
    'User-Agent: Mozilla/5.0 (peng-stock-analysis stock-data tencent curl)',
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

async function requestTencentRealtimeQuote(stockCode) {
  const symbol = toTencentStockSymbol(stockCode);
  if (!symbol) {
    throw new HttpError(400, '腾讯备用源仅支持A股代码');
  }

  const url = new URL('https://qt.gtimg.cn/');
  url.searchParams.set('q', symbol);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (peng-stock-analysis stock-data tencent)',
        Referer: 'https://gu.qq.com/',
      },
    });
    if (!response.ok) {
      throw new HttpError(response.status, `腾讯实时行情请求失败: ${response.status}`);
    }

    const text = decodeGbkPayload(Buffer.from(await response.arrayBuffer()));
    return parseTencentRealtimeQuote(text, stockCode);
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('fetch failed')) {
      console.error('[stock-data-fetch-failed]', {
        at: nowLocalDateTime(),
        stage: 'requestTencentRealtimeQuote',
        stockCode: normalizeStockCode(stockCode),
        remoteUrl: url.toString(),
        errorMessage: message,
      });
      if (error?.stack) {
        console.error('[stock-data-fetch-failed][trace]', error.stack);
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
      return parseTencentRealtimeQuote(text, stockCode);
    } catch (curlError) {
      console.error('[stock-data-fetch-failed][curl]', {
        at: nowLocalDateTime(),
        stage: 'requestTencentRealtimeQuote',
        stockCode: normalizeStockCode(stockCode),
        remoteUrl: url.toString(),
        errorMessage: String(curlError?.message || ''),
      });
      if (curlError?.stack) {
        console.error('[stock-data-fetch-failed][curl-trace]', curlError.stack);
      }
      throw curlError;
    }
  }
}

async function requestYahooChart(symbol, { range = '6mo', interval = '1d' } = {}) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set('range', range);
  url.searchParams.set('interval', interval);
  url.searchParams.set('events', 'div,splits');

  let response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (peng-stock-analysis)',
      },
    });
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('fetch failed')) {
      console.error('[stock-data-fetch-failed]', {
        stage: 'requestYahooChart',
        symbol,
        remoteUrl: url.toString(),
        errorMessage: message,
      });
      if (error?.stack) {
        console.error('[stock-data-fetch-failed][trace]', error.stack);
      }
    }
    throw error;
  }

  if (!response.ok) {
    throw new HttpError(response.status, `行情服务请求失败: ${response.status}`);
  }

  const json = await response.json();
  return parseChartPayload(json);
}

function toStooqSymbol(normalizedCode) {
  const market = inferMarket(normalizedCode);
  if (market === 'US') {
    return `${normalizedCode.toLowerCase()}.us`;
  }
  if (market === 'CN_SH' || market === 'CN_SZ') {
    return `${normalizedCode}.cn`;
  }
  if (market === 'HK') {
    const digits = normalizedCode.startsWith('HK')
      ? normalizedCode.replace('HK', '')
      : normalizedCode;
    const compact = String(Number(digits));
    return `${compact}.hk`;
  }
  return null;
}

function parseStooqCsv(text) {
  const content = String(text || '').trim();
  if (!content || content.toLowerCase().startsWith('no data')) {
    return [];
  }

  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const [date, open, high, low, close, volume] = lines[i].split(',');
    if (!date || close === 'N/D') continue;

    const closeNum = Number(close);
    if (!Number.isFinite(closeNum) || closeNum <= 0) continue;

    rows.push({
      ts: Math.floor(new Date(`${date}T15:00:00Z`).getTime() / 1000),
      date,
      open: Number(open || closeNum),
      high: Number(high || closeNum),
      low: Number(low || closeNum),
      close: closeNum,
      volume: Number(volume || 0),
    });
  }

  return rows;
}

async function requestStooqChart(normalizedCode, days = 180) {
  const stooqSymbol = toStooqSymbol(normalizedCode);
  if (!stooqSymbol) {
    throw new HttpError(404, '当前代码不支持 Stooq 数据源');
  }

  const url = new URL('https://stooq.com/q/d/l/');
  url.searchParams.set('s', stooqSymbol);
  url.searchParams.set('i', 'd');

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (peng-stock-analysis)',
    },
  });
  if (!response.ok) {
    throw new HttpError(response.status, `Stooq 请求失败: ${response.status}`);
  }

  const text = await response.text();
  const rows = parseStooqCsv(text);
  if (!rows.length) {
    throw new HttpError(404, `Stooq 无数据: ${stooqSymbol}`);
  }

  return {
    meta: {
      shortName: `${normalizedCode} (Stooq)`,
      dataSource: 'stooq',
      stooqSymbol,
    },
    rows: rows.slice(-Math.max(days, 200)),
  };
}

function hashString(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function seededRandom(seed) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function buildSyntheticChart(symbol, days = 220) {
  const seed = hashString(symbol);
  const random = seededRandom(seed);
  const base = 12 + (seed % 1200) / 10;

  const prices = [];
  let price = base * (0.85 + random() * 0.3);
  for (let i = 0; i < days; i += 1) {
    const trendBias = (seed % 2 === 0 ? 1 : -1) * 0.0015;
    const swing = (random() - 0.5) * 0.045 + trendBias;
    price = Math.max(1, price * (1 + swing));
    prices.push(Number(price.toFixed(2)));
  }

  const rows = [];
  let cursor = new Date();
  let idx = prices.length - 1;
  while (rows.length < days && idx >= 0) {
    const weekday = cursor.getDay();
    if (weekday === 0 || weekday === 6) {
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }

    const close = prices[idx];
    const prevClose = prices[idx - 1] || close;
    const high = close * (1 + random() * 0.015);
    const low = close * (1 - random() * 0.015);
    const open = (close + prevClose) / 2;
    const volume = 120000 + Math.floor(random() * 800000);

    rows.push({
      ts: Math.floor(cursor.getTime() / 1000),
      date: cursor.toISOString().slice(0, 10),
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume,
    });

    cursor.setDate(cursor.getDate() - 1);
    idx -= 1;
  }

  rows.reverse();

  return {
    meta: {
      shortName: `${symbol} (Synthetic)`,
      longName: `${symbol} Synthetic Data`,
    },
    rows,
  };
}

export const stockDataService = {
  async getXTickIntraday(stockCode, { limit = 120 } = {}) {
    return requestXTickMinuteSeries(stockCode, { limit });
  },

  async getHistory(stockCode, { days = 180, interval = '1d' } = {}) {
    const normalized = normalizeStockCode(stockCode);
    const symbol = toYahooSymbol(normalized);
    const range = getRangeFromDays(days);
    let payload;
    let source = 'yahoo';
    try {
      payload = await requestYahooChart(symbol, { range, interval });
    } catch (yahooError) {
      try {
        payload = await requestStooqChart(normalized, days);
        source = 'stooq';
        payload.meta.fallbackReason = yahooError.message;
      } catch (stooqError) {
        payload = buildSyntheticChart(symbol, Math.max(days, 200));
        source = 'synthetic';
        payload.meta.fallbackReason = `${yahooError.message}; ${stooqError.message}`;
      }
    }

    const closes = payload.rows.map((item) => item.close);
    const volumes = payload.rows.map((item) => item.volume);
    const ma5 = movingAverage(closes, 5);
    const ma10 = movingAverage(closes, 10);
    const ma20 = movingAverage(closes, 20);

    const rows = payload.rows.map((item, idx) => ({
      ...item,
      ma5: ma5[idx],
      ma10: ma10[idx],
      ma20: ma20[idx],
    }));

    const latest = rows[rows.length - 1];
    const prev = rows[rows.length - 2] || latest;
    const avgVol5 = average(volumes.slice(-5));

    const quote = {
      stockCode: normalized,
      symbol,
      stockName: payload.meta?.shortName || payload.meta?.longName || normalized,
      market: inferMarket(normalized),
      price: latest?.close || 0,
      open: latest?.open || 0,
      high: latest?.high || 0,
      low: latest?.low || 0,
      prevClose: prev?.close || latest?.close || 0,
      changePct: pctChange(latest?.close || 0, prev?.close || latest?.close || 1),
      volume: latest?.volume || 0,
      volumeRatio: avgVol5 ? Number(((latest?.volume || 0) / avgVol5).toFixed(2)) : 1,
      ma5: latest?.ma5 || null,
      ma10: latest?.ma10 || null,
      ma20: latest?.ma20 || null,
      dataSource: source,
      fetchedAt: nowLocalDateTime(),
    };

    return {
      quote,
      history: rows,
    };
  },

  async getQuote(stockCode) {
    const normalized = normalizeStockCode(stockCode);
    const market = inferMarket(normalized);

    if (market === 'CN_SH' || market === 'CN_SZ') {
      try {
        return await requestTencentRealtimeQuote(normalized);
      } catch {}

      try {
        return await requestXTickRealtimeQuote(normalized);
      } catch {}
    }

    const result = await this.getHistory(normalized, { days: 30 });
    return result.quote;
  },
};

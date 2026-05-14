import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { futuresRepository } from '../repositories/futuresRepository.js';
import { stockBarsRepository } from '../repositories/stockBarsRepository.js';
import { stockMonitorRepository } from '../repositories/stockMonitorRepository.js';
import { stockBasicsRepository } from '../repositories/stockBasicsRepository.js';
import { marketSyncJobRepository } from '../repositories/marketSyncJobRepository.js';
import { marketQualityRepository } from '../repositories/marketQualityRepository.js';
import { stockDataService } from './stockDataService.js';
import { HttpError } from '../utils/httpError.js';
import { nowLocalDateTime } from '../utils/date.js';

const FUTURES_HISTORY_UT = 'fa5fd1943c7b386f172d6893dbfba10b';
const execFileAsync = promisify(execFile);
const OVERVIEW_SYMBOL_LIMIT = 50000;
const LIGHT_OVERVIEW_MAX_SPAN_DAYS = 366;
const LIGHT_OVERVIEW_MAX_TOTAL_BARS = 2000000;

const INTRADAY_TIMEFRAME_SECONDS = {
  '30s': 30,
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '60m': 3600,
  '1d': 86400,
  '1w': 7 * 86400,
  '1M': 30 * 86400,
};
const STOCK_DAILY_SYNC_MAX_RETRIES = 3;
const SYNC_JOB_STALE_MINUTES = 30;

const SYNCABLE_RULES_BY_SYMBOL_TYPE = {
  futures: {
    '1m': { klt: '1', periodDays: 1 / 1440, maxDays: 7, maxLmt: 20000, label: '分钟', datasetScope: 'futures_intraday_bars' },
    '1d': { klt: '101', periodDays: 1, maxLmt: 8000, label: '日', datasetScope: 'futures_eod_bars' },
    '1w': { klt: '102', periodDays: 7, maxLmt: 8000, label: '周', datasetScope: 'futures_eod_bars' },
    '1M': { klt: '103', periodDays: 30, maxLmt: 8000, label: '月', datasetScope: 'futures_eod_bars' },
  },
  stock: {
    '1d': { klt: '101', periodDays: 1, maxLmt: 2000, label: '日', datasetScope: 'stock_eod_bars' },
  },
};

function normalizeMarketDataTimeframe(input) {
  const key = String(input || '').trim();
  if (!key) return '1m';

  const aliasMap = {
    minute: '1m',
    day: '1d',
    week: '1w',
    month: '1M',
    '1m': '1m',
    '1d': '1d',
    '1w': '1w',
    '1M': '1M',
    '1mo': '1M',
    '1mon': '1M',
  };
  return aliasMap[key] || key;
}

function normalizeSymbolType(input) {
  const text = String(input || 'futures').trim().toLowerCase();
  if (text === 'stock') return 'stock';
  return 'futures';
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
  return Math.min(Math.max(Number(n) || 0, min), max);
}

function calcMissingBarsBySpan(firstBucketTs, lastBucketTs, bars, intervalSeconds) {
  const first = Number(firstBucketTs);
  const last = Number(lastBucketTs);
  const count = Number(bars);
  if (!Number.isFinite(first) || !Number.isFinite(last) || !Number.isFinite(count) || count <= 0 || intervalSeconds <= 0) {
    return 0;
  }
  const expected = Math.floor((last - first) / intervalSeconds) + 1;
  return Math.max(expected - count, 0);
}

function attachGapMetrics(items = [], intervalSeconds = 60, order = 'desc') {
  const lastTsByCode = new Map();
  const normalizedOrder = String(order || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  return items.map((item) => {
    const currentTs = Number(item.bucketTs);
    let gapSeconds = null;
    let gapBars = 0;
    const codeKey = String(item.quoteCode || item.stockCode || '').trim().toUpperCase();
    const prevTs = lastTsByCode.get(codeKey);
    if (Number.isFinite(prevTs) && Number.isFinite(currentTs)) {
      const delta = normalizedOrder === 'asc'
        ? (currentTs - prevTs)
        : (prevTs - currentTs);
      if (delta > intervalSeconds) {
        gapSeconds = delta;
        gapBars = Math.max(Math.floor(delta / intervalSeconds) - 1, 0);
      } else if (delta >= 0) {
        gapSeconds = delta;
      }
    }
    lastTsByCode.set(codeKey, currentTs);
    return {
      ...item,
      gapSeconds,
      gapBars,
    };
  });
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatLocalDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDateInput(dayText, label = '日期') {
  const text = String(dayText || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new HttpError(400, `${label}格式非法，应为 YYYY-MM-DD`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (!Number.isFinite(date.getTime())) {
    throw new HttpError(400, `${label}无效`);
  }
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new HttpError(400, `${label}无效`);
  }
  return date;
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function sleep(ms = 0) {
  const timeout = Math.max(0, Number(ms) || 0);
  return new Promise((resolve) => setTimeout(resolve, timeout));
}

function isTushareRateLimitError(error) {
  const message = String(error?.message || '');
  return message.includes('code=40203') || message.includes('频率超限');
}

function parseDateTimeMs(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  if (/^\d{10,13}$/.test(text)) {
    const num = Number(text);
    if (!Number.isFinite(num)) return null;
    return text.length === 10 ? num * 1000 : num;
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    const parsed = new Date(text.replace(' ', 'T')).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  const parsed = new Date(text).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function calcSyncJobProgress(details = []) {
  const totalItems = details.length;
  const successItems = details.filter((entry) => entry.status === 'success').length;
  const successWrittenItems = details.filter((entry) => entry.status === 'success' && Number(entry?.barsWritten || 0) > 0).length;
  const successNoWriteItems = Math.max(successItems - successWrittenItems, 0);
  const failedItems = details.filter((entry) => entry.status === 'failed').length;
  const runningItems = details.filter((entry) => entry.status === 'running').length;
  const queuedItems = details.filter((entry) => entry.status === 'queued').length;
  const doneItems = successItems + failedItems;
  const progressPct = totalItems > 0
    ? Number(((doneItems / totalItems) * 100).toFixed(2))
    : 0;
  return {
    totalItems,
    successItems,
    successWrittenItems,
    successNoWriteItems,
    failedItems,
    runningItems,
    queuedItems,
    doneItems,
    progressPct,
  };
}

function summarizeSyncOutcome(success = [], failed = []) {
  const successWithWriteSymbols = (Array.isArray(success) ? success : [])
    .filter((item) => Number(item?.writtenBars || 0) > 0)
    .length;
  const successNoWriteSymbols = Math.max((Array.isArray(success) ? success.length : 0) - successWithWriteSymbols, 0);
  return {
    successWithWriteSymbols,
    successNoWriteSymbols,
    failedSymbols: Array.isArray(failed) ? failed.length : 0,
  };
}

function resolveTerminalStatusByProgress(progress = {}) {
  if (Number(progress.failedItems || 0) > 0) {
    return Number(progress.successItems || 0) > 0 ? 'partial_failed' : 'failed';
  }
  return 'success';
}

function calcSyncJobLastActivityMs(job = {}, details = []) {
  const points = [
    job.createdAt,
    job.updatedAt,
    job.startedAt,
    job.finishedAt,
    ...details.flatMap((item) => [item.createdAt, item.updatedAt, item.startedAt, item.finishedAt]),
  ];
  let latest = null;
  points.forEach((value) => {
    const ms = parseDateTimeMs(value);
    if (!Number.isFinite(ms)) return;
    if (!Number.isFinite(latest) || ms > latest) latest = ms;
  });
  return latest;
}

function dateToCompact(dayText) {
  return String(dayText || '').replace(/-/g, '');
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

function parseKlineRow(line) {
  const parts = String(line || '').split(',');
  if (parts.length < 6) return null;
  const date = parts[0];
  const open = toNum(parts[1], null);
  const close = toNum(parts[2], null);
  const high = toNum(parts[3], null);
  const low = toNum(parts[4], null);
  const volume = toNum(parts[5], 0);
  const amount = toNum(parts[6], 0);
  if (!date || close == null) return null;

  return {
    date,
    open,
    high,
    low,
    close,
    volume,
    amount,
  };
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
      quoteCode: `${market}.${code}`.toUpperCase(),
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
        quoteCode: `${market}.${code}`.toUpperCase(),
      };
    }
  }

  throw new HttpError(400, `无法识别品种代码: ${input}`);
}

function briefErrorMessage(error, fallback = '未知错误') {
  const stderr = String(error?.stderr || '').trim();
  const message = String(error?.message || '').trim();
  const source = stderr || message || fallback;
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] || fallback;
}

async function requestJsonByCurl(url, timeoutMs = 9000) {
  const seconds = Math.max(3, Math.min(20, Math.ceil(Number(timeoutMs) / 1000)));
  const args = [
    '-sS',
    '--noproxy',
    '*',
    '--proxy',
    '',
    '--max-time',
    String(seconds),
    '-H',
    'User-Agent: Mozilla/5.0 (peng-stock-analysis market-data-sync)',
    '-H',
    'Accept: application/json,text/plain,*/*',
    String(url),
  ];

  const { stdout } = await execFileAsync('curl', args, {
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      http_proxy: '',
      https_proxy: '',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
    },
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

async function requestJson(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (peng-stock-analysis market-data-sync)',
      },
    });
    if (!response.ok) {
      throw new HttpError(response.status, `行情请求失败: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new HttpError(504, '行情请求超时');
    }
    if (error instanceof HttpError) throw error;

    const msg = String(error?.message || '');
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
        throw new HttpError(502, `行情请求异常: ${msg}; curl降级失败: ${briefErrorMessage(curlError)}`);
      }
    }
    throw new HttpError(502, `行情请求异常: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

function dedupeSymbols(items = [], key = 'quoteCode') {
  return Array.from(new Map(
    (items || []).map((item) => [String(item[key] || '').trim().toUpperCase(), item]),
  ).values()).filter((item) => item[key]);
}

function isLikelyAStockCode(code = '') {
  const text = String(code || '').trim().toUpperCase();
  if (!/^\d{6}$/.test(text)) return false;
  return (
    text.startsWith('000')
    || text.startsWith('001')
    || text.startsWith('002')
    || text.startsWith('003')
    || text.startsWith('300')
    || text.startsWith('301')
    || text.startsWith('600')
    || text.startsWith('601')
    || text.startsWith('603')
    || text.startsWith('605')
    || text.startsWith('688')
    || text.startsWith('689')
  );
}

function resolveFuturesSymbolsForSync(quoteCodeFilter = '') {
  const configured = dedupeSymbols(
    futuresRepository.listSymbols({ onlyActive: true }).map((item) => ({
      quoteCode: String(item.quoteCode || '').trim().toUpperCase(),
      name: item.name || '',
    })),
    'quoteCode',
  );

  const filterText = String(quoteCodeFilter || '').trim().toUpperCase();
  if (!filterText) {
    if (!configured.length) {
      throw new HttpError(400, '未配置可同步品种，请先在期货监测中添加品种');
    }
    return configured;
  }

  const matched = configured.filter((item) => {
    const q = String(item.quoteCode || '').toUpperCase();
    const n = String(item.name || '').toUpperCase();
    return q.includes(filterText) || n.includes(filterText);
  });

  let normalized = null;
  try {
    normalized = normalizeQuoteCode(filterText);
  } catch {
    normalized = null;
  }

  if (normalized && !matched.some((item) => item.quoteCode === normalized.quoteCode)) {
    matched.push({ quoteCode: normalized.quoteCode, name: normalized.code });
  }

  const output = dedupeSymbols(matched, 'quoteCode');
  if (!output.length) {
    throw new HttpError(404, `未匹配到可同步品种: ${quoteCodeFilter}`);
  }
  return output;
}

function resolveStockSymbolsForSync(stockCodeFilter = '') {
  const fromBasics = dedupeSymbols(
    stockBasicsRepository.listByMarket('A').map((item) => ({
      stockCode: String(item.code || '').trim().toUpperCase(),
      name: item.name || '',
    })).filter((item) => isLikelyAStockCode(item.stockCode)),
    'stockCode',
  );
  const configured = dedupeSymbols(
    stockMonitorRepository.listSymbols({ onlyActive: true, symbolType: 'stock' }).map((item) => ({
      stockCode: String(item.stockCode || '').trim().toUpperCase(),
      name: item.name || '',
    })),
    'stockCode',
  );
  const universe = fromBasics.length ? fromBasics : configured;

  const filterText = String(stockCodeFilter || '').trim().toUpperCase();
  const normalizedFilter = filterText.replace(/^(SH|SZ)/, '');
  if (!filterText) {
    if (!universe.length) {
      throw new HttpError(400, '未找到可同步股票，请先同步股票基础信息（stock_basics）');
    }
    return universe;
  }

  const output = universe.filter((item) => {
    const code = String(item.stockCode || '').toUpperCase();
    const name = String(item.name || '').toUpperCase();
    return (
      code.includes(filterText)
      || code.includes(normalizedFilter)
      || name.includes(filterText)
    );
  });

  if (!output.length) {
    throw new HttpError(404, `未匹配到可同步股票: ${stockCodeFilter}`);
  }

  return output;
}

async function fetchKlineHistory({ secid, klt, startDay, endDay, lmt }) {
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');
  url.searchParams.set('secid', secid);
  url.searchParams.set('ut', FUTURES_HISTORY_UT);
  url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6');
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58');
  url.searchParams.set('klt', klt);
  url.searchParams.set('fqt', '0');
  url.searchParams.set('beg', dateToCompact(startDay));
  url.searchParams.set('end', dateToCompact(endDay));
  url.searchParams.set('lmt', String(lmt));

  const payload = await requestJson(url.toString(), 10000);
  const rows = payload?.data?.klines || [];
  return rows.map(parseKlineRow).filter(Boolean);
}

function candlesToBars(candles = [], startDay, endDay, source = 'eastmoney.push2his') {
  const out = [];
  const map = new Map();
  (candles || []).forEach((item) => {
    const dateText = String(item?.date || '');
    const day = dateText.slice(0, 10);
    if (!day || day < startDay || day > endDay) return;
    const bucketTs = parseCandleDateToTs(dateText);
    if (!Number.isFinite(bucketTs)) return;
    map.set(bucketTs, {
      tradeDay: day,
      bucketTs,
      date: dateText,
      open: toNum(item.open, null),
      high: toNum(item.high, null),
      low: toNum(item.low, null),
      close: toNum(item.close, null),
      volume: toNum(item.volume, 0),
      amount: toNum(item.amount, 0),
      source,
    });
  });

  map.forEach((item) => out.push(item));
  out.sort((a, b) => a.bucketTs - b.bucketTs);
  return out;
}

function summarizeSymbols(rows = [], intervalSeconds, symbolField = 'quoteCode') {
  const symbols = rows.map((row) => {
    const bars = toNum(row.bars, 0);
    const estimatedMissingBars = calcMissingBarsBySpan(
      row.firstBucketTs,
      row.lastBucketTs,
      bars,
      intervalSeconds,
    );
    const completenessPct = bars > 0
      ? Number(((bars / (bars + estimatedMissingBars)) * 100).toFixed(2))
      : 0;
    return {
      [symbolField]: row[symbolField],
      symbolName: row.symbolName || '',
      bars,
      estimatedMissingBars,
      completenessPct,
      firstDate: row.firstDate || null,
      lastDate: row.lastDate || null,
      updatedAt: row.updatedAt || null,
    };
  });

  const totalBars = symbols.reduce((sum, item) => sum + toNum(item.bars, 0), 0);
  const totalMissingBars = symbols.reduce((sum, item) => sum + toNum(item.estimatedMissingBars, 0), 0);
  const completenessPct = totalBars > 0
    ? Number(((totalBars / (totalBars + totalMissingBars)) * 100).toFixed(2))
    : 0;
  const firstDate = symbols.reduce((acc, item) => {
    if (!item.firstDate) return acc;
    if (!acc) return item.firstDate;
    return item.firstDate < acc ? item.firstDate : acc;
  }, '');
  const lastDate = symbols.reduce((acc, item) => {
    if (!item.lastDate) return acc;
    if (!acc) return item.lastDate;
    return item.lastDate > acc ? item.lastDate : acc;
  }, '');

  return {
    symbols,
    summary: {
      symbolCount: symbols.length,
      totalBars,
      estimatedMissingBars: totalMissingBars,
      completenessPct,
      firstDate: firstDate || null,
      lastDate: lastDate || null,
    },
  };
}

function buildStockQueryPayload(payload = {}) {
  const timeframe = normalizeMarketDataTimeframe(payload.timeframe || '1m');
  const intervalSeconds = INTRADAY_TIMEFRAME_SECONDS[timeframe];
  if (!intervalSeconds) {
    throw new HttpError(400, `不支持的时间粒度: ${timeframe}`);
  }

  const stockCode = String(payload.stockCode || payload.quoteCode || '').trim().toUpperCase();
  let tradeDay = String(payload.tradeDay || '').trim();
  let startDay = String(payload.startDay || '').trim();
  let endDay = String(payload.endDay || '').trim();
  if (tradeDay && !/^\d{4}-\d{2}-\d{2}$/.test(tradeDay)) {
    throw new HttpError(400, 'tradeDay 格式非法，应为 YYYY-MM-DD');
  }
  if (startDay && !/^\d{4}-\d{2}-\d{2}$/.test(startDay)) {
    throw new HttpError(400, 'startDay 格式非法，应为 YYYY-MM-DD');
  }
  if (endDay && !/^\d{4}-\d{2}-\d{2}$/.test(endDay)) {
    throw new HttpError(400, 'endDay 格式非法，应为 YYYY-MM-DD');
  }

  if (tradeDay && !startDay && !endDay) {
    startDay = tradeDay;
    endDay = tradeDay;
  }

  if (startDay && endDay && startDay > endDay) {
    throw new HttpError(400, '开始日期不能晚于结束日期');
  }

  tradeDay = startDay && endDay && startDay === endDay ? startDay : '';

  const page = clamp(payload.page || 1, 1, 100000);
  const limit = clamp(payload.limit || 200, 20, 1000);

  return {
    timeframe,
    intervalSeconds,
    stockCode,
    tradeDay,
    startDay,
    endDay,
    page,
    limit,
  };
}

function buildFuturesQueryPayload(payload = {}) {
  const timeframe = normalizeMarketDataTimeframe(payload.timeframe || '1m');
  const intervalSeconds = INTRADAY_TIMEFRAME_SECONDS[timeframe];
  if (!intervalSeconds) {
    throw new HttpError(400, `不支持的时间粒度: ${timeframe}`);
  }

  const quoteCode = String(payload.quoteCode || '').trim().toUpperCase();
  let tradeDay = String(payload.tradeDay || '').trim();
  let startDay = String(payload.startDay || '').trim();
  let endDay = String(payload.endDay || '').trim();
  if (tradeDay && !/^\d{4}-\d{2}-\d{2}$/.test(tradeDay)) {
    throw new HttpError(400, 'tradeDay 格式非法，应为 YYYY-MM-DD');
  }
  if (startDay && !/^\d{4}-\d{2}-\d{2}$/.test(startDay)) {
    throw new HttpError(400, 'startDay 格式非法，应为 YYYY-MM-DD');
  }
  if (endDay && !/^\d{4}-\d{2}-\d{2}$/.test(endDay)) {
    throw new HttpError(400, 'endDay 格式非法，应为 YYYY-MM-DD');
  }

  if (tradeDay && !startDay && !endDay) {
    startDay = tradeDay;
    endDay = tradeDay;
  }

  if (!startDay && !endDay) {
    const latestDay = futuresRepository.getLatestIntradayTradeDayOverall({
      timeframe,
      quoteCode,
    }) || '';
    startDay = latestDay;
    endDay = latestDay;
  }

  if (startDay && endDay && startDay > endDay) {
    throw new HttpError(400, '开始日期不能晚于结束日期');
  }

  tradeDay = startDay && endDay && startDay === endDay ? startDay : '';

  const page = clamp(payload.page || 1, 1, 100000);
  const limit = clamp(payload.limit || 200, 20, 1000);

  return {
    timeframe,
    intervalSeconds,
    quoteCode,
    tradeDay,
    startDay,
    endDay,
    page,
    limit,
  };
}

function buildRangeFallback(startDay, endDay, timeframe, symbolType) {
  if (startDay && endDay) return { startDay, endDay };
  const today = formatLocalDate(new Date());
  if (symbolType === 'stock') {
    if (timeframe === '1m') return { startDay: today, endDay: today };
    const back = addDays(new Date(), -120);
    return { startDay: formatLocalDate(back), endDay: today };
  }
  return { startDay, endDay };
}

function persistQualityReport({ symbolType, timeframe, payload }) {
  try {
    const datasetName = symbolType === 'stock' ? 'stock_intraday_bars' : 'futures_intraday_bars';
    marketQualityRepository.createReport({
      datasetName,
      symbolType,
      timeframe,
      scopeType: 'range',
      scopeKey: payload?.filters?.quoteCode || payload?.filters?.stockCode || null,
      startDate: payload?.filters?.startDay || null,
      endDate: payload?.filters?.endDay || null,
      totalExpected: Number(payload?.summary?.totalBars || 0) + Number(payload?.summary?.estimatedMissingBars || 0),
      totalActual: Number(payload?.summary?.totalBars || 0),
      gapCount: Number(payload?.summary?.estimatedMissingBars || 0),
      anomalyCount: 0,
      coverageRatio: Number(payload?.summary?.completenessPct || 0),
      reportJson: JSON.stringify({
        pagination: payload?.pagination || null,
        summary: payload?.summary || null,
      }),
    });
  } catch {}
}

export const marketDataService = {
  queryMarketData(payload = {}) {
    const symbolType = normalizeSymbolType(payload.symbolType || payload.assetType || 'futures');

    if (symbolType === 'stock') {
      const base = buildStockQueryPayload(payload);
      const fallback = buildRangeFallback(base.startDay, base.endDay, base.timeframe, symbolType);
      const startDay = fallback.startDay;
      const endDay = fallback.endDay;
      const tradeDay = startDay && endDay && startDay === endDay ? startDay : '';

      const useEodTable = ['1d', '1w', '1M'].includes(base.timeframe);

      const total = useEodTable
        ? stockBarsRepository.countEodBars({
          timeframe: base.timeframe,
          tradeDay,
          startDay,
          endDay,
          stockCode: base.stockCode,
        })
        : stockBarsRepository.countIntradayBars({
          timeframe: base.timeframe,
          tradeDay,
          startDay,
          endDay,
          stockCode: base.stockCode,
        });

      const rawItems = useEodTable
        ? stockBarsRepository.listEodBarsForReview({
          timeframe: base.timeframe,
          tradeDay,
          startDay,
          endDay,
          stockCode: base.stockCode,
          page: base.page,
          limit: base.limit,
        })
        : stockBarsRepository.listIntradayBarsForReview({
          timeframe: base.timeframe,
          tradeDay,
          startDay,
          endDay,
          stockCode: base.stockCode,
          page: base.page,
          limit: base.limit,
        });

      const items = attachGapMetrics(rawItems.map((item) => ({ ...item, quoteCode: item.stockCode })), base.intervalSeconds, 'desc');

      let symbols = [];
      let summary = {
        symbolCount: 0,
        totalBars: total,
        estimatedMissingBars: 0,
        completenessPct: 0,
        firstDate: null,
        lastDate: null,
      };

      const canTryLightOverview = useEodTable && !String(base.stockCode || '').trim();
      const spanDays = (startDay && endDay)
        ? Math.max(Math.floor((parseDateInput(endDay, 'endDay').getTime() - parseDateInput(startDay, 'startDay').getTime()) / 86400000) + 1, 1)
        : 1;
      const useLightOverview = canTryLightOverview
        && spanDays > LIGHT_OVERVIEW_MAX_SPAN_DAYS
        && total > LIGHT_OVERVIEW_MAX_TOTAL_BARS;

      if (useLightOverview) {
        const eodSummary = stockBarsRepository.summarizeEodBars({
          timeframe: base.timeframe,
          tradeDay,
          startDay,
          endDay,
          stockCode: base.stockCode,
        });
        summary = {
          symbolCount: Number(eodSummary.symbolCount || 0),
          totalBars: total,
          estimatedMissingBars: 0,
          completenessPct: 100,
          firstDate: eodSummary.firstDate || null,
          lastDate: eodSummary.lastDate || null,
          overviewMode: 'light',
        };
      } else {
        const overviewRows = (useEodTable
          ? stockBarsRepository.listEodSymbolsOverview({
            timeframe: base.timeframe,
            tradeDay,
            startDay,
            endDay,
            stockCode: base.stockCode,
            limit: OVERVIEW_SYMBOL_LIMIT,
          })
          : stockBarsRepository.listIntradaySymbolsOverview({
            timeframe: base.timeframe,
            tradeDay,
            startDay,
            endDay,
            stockCode: base.stockCode,
            limit: OVERVIEW_SYMBOL_LIMIT,
          })).map((item) => ({ ...item, quoteCode: item.stockCode }));

        const overviewResult = summarizeSymbols(overviewRows, base.intervalSeconds, 'quoteCode');
        symbols = overviewResult.symbols;
        summary = overviewResult.summary;
      }

      const result = {
        dataset: useEodTable ? 'stock_eod_bars' : 'stock_intraday_bars',
        symbolType,
        filters: {
          timeframe: base.timeframe,
          tradeDay,
          startDay,
          endDay,
          stockCode: base.stockCode,
          quoteCode: base.stockCode,
          page: base.page,
          limit: base.limit,
        },
        pagination: {
          page: base.page,
          limit: base.limit,
          total,
          totalPages: total > 0 ? Math.ceil(total / base.limit) : 0,
        },
        summary,
        symbols,
        items,
      };
      persistQualityReport({ symbolType, timeframe: base.timeframe, payload: result });
      return result;
    }

    const base = buildFuturesQueryPayload(payload);
    if (!base.startDay && !base.endDay) {
      const emptyResult = {
        dataset: 'futures_intraday_bars',
        symbolType,
        filters: {
          timeframe: base.timeframe,
          tradeDay: null,
          startDay: null,
          endDay: null,
          quoteCode: base.quoteCode,
          page: base.page,
          limit: base.limit,
        },
        pagination: {
          page: base.page,
          limit: base.limit,
          total: 0,
          totalPages: 0,
        },
        summary: {
          symbolCount: 0,
          totalBars: 0,
          estimatedMissingBars: 0,
          completenessPct: 0,
          firstDate: null,
          lastDate: null,
        },
        symbols: [],
        items: [],
      };
      persistQualityReport({ symbolType, timeframe: base.timeframe, payload: emptyResult });
      return emptyResult;
    }

    const total = futuresRepository.countIntradayBarsForReview({
      timeframe: base.timeframe,
      tradeDay: base.tradeDay,
      startDay: base.startDay,
      endDay: base.endDay,
      quoteCode: base.quoteCode,
    });

    const rawItems = futuresRepository.listIntradayBarsForReview({
      timeframe: base.timeframe,
      tradeDay: base.tradeDay,
      startDay: base.startDay,
      endDay: base.endDay,
      quoteCode: base.quoteCode,
      page: base.page,
      limit: base.limit,
    });
    const items = attachGapMetrics(rawItems, base.intervalSeconds, 'desc');

    const overviewRows = futuresRepository.listIntradaySymbolsOverview({
      timeframe: base.timeframe,
      tradeDay: base.tradeDay,
      startDay: base.startDay,
      endDay: base.endDay,
      quoteCode: base.quoteCode,
      limit: OVERVIEW_SYMBOL_LIMIT,
    });
    const { symbols, summary } = summarizeSymbols(overviewRows, base.intervalSeconds, 'quoteCode');

    const result = {
      dataset: 'futures_intraday_bars',
      symbolType,
      filters: {
        timeframe: base.timeframe,
        tradeDay: base.tradeDay,
        startDay: base.startDay,
        endDay: base.endDay,
        quoteCode: base.quoteCode,
        page: base.page,
        limit: base.limit,
      },
      pagination: {
        page: base.page,
        limit: base.limit,
        total,
        totalPages: total > 0 ? Math.ceil(total / base.limit) : 0,
      },
      summary,
      symbols,
      items,
    };

    persistQualityReport({ symbolType, timeframe: base.timeframe, payload: result });
    return result;
  },

  async syncMarketData(payload = {}) {
    const symbolType = normalizeSymbolType(payload.symbolType || payload.assetType || 'futures');
    const timeframe = normalizeMarketDataTimeframe(payload.timeframe || '1m');
    const rule = SYNCABLE_RULES_BY_SYMBOL_TYPE[symbolType]?.[timeframe];
    if (!rule) {
      const supported = Object.keys(SYNCABLE_RULES_BY_SYMBOL_TYPE[symbolType] || {})
        .map((key) => `${key}`)
        .join(', ');
      throw new HttpError(400, `${symbolType} 当前仅支持以下粒度手动同步: ${supported || '--'}`);
    }

    const syncRange = String(payload.syncRange || 'single_day') === 'from_trade_day_to_now'
      ? 'from_trade_day_to_now'
      : 'single_day';
    const startDay = String(payload.tradeDay || '').trim();
    if (!startDay) {
      throw new HttpError(400, '请选择要同步的起始交易日');
    }
    parseDateInput(startDay, 'tradeDay');

    const today = formatLocalDate(new Date());
    const hasLookbackLimit = Number.isFinite(Number(rule.maxDays)) && Number(rule.maxDays) > 0;
    const earliestAllowedDay = hasLookbackLimit
      ? formatLocalDate(addDays(new Date(), -(Number(rule.maxDays) - 1)))
      : '';
    if (hasLookbackLimit && startDay < earliestAllowedDay) {
      throw new HttpError(400, `${rule.label}粒度最早仅支持同步到 ${earliestAllowedDay}，以避免过量历史加载`);
    }
    if (startDay > today) {
      throw new HttpError(400, '起始交易日不能晚于今天');
    }

    const endDay = syncRange === 'from_trade_day_to_now' ? today : startDay;
    const daySpan = Math.max(
      Math.floor((parseDateInput(endDay, 'endDay').getTime() - parseDateInput(startDay, 'startDay').getTime()) / 86400000) + 1,
      1,
    );
    const expectedBars = Math.ceil(daySpan / Math.max(Number(rule.periodDays || 1), 1 / 1440));
    const lmt = clamp(Math.ceil(expectedBars * 1.6), 800, rule.maxLmt);

    const job = marketSyncJobRepository.createJob({
      jobType: 'sync',
      triggerType: 'manual',
      marketScope: symbolType,
      datasetScope: rule.datasetScope,
      symbolType,
      timeframe,
      startDate: startDay,
      endDate: endDay,
      status: 'running',
      startedAt: nowLocalDateTime(),
      paramsJson: JSON.stringify(payload || {}),
    });

    const success = [];
    const failed = [];
    let writtenBars = 0;
    let firstSyncedDay = null;
    let lastSyncedDay = null;

    try {
      if (symbolType === 'stock') {
        const symbols = resolveStockSymbolsForSync(payload.stockCode || payload.quoteCode);
        const canUseBatchDaily = timeframe === '1d' && startDay === endDay;

        if (canUseBatchDaily) {
          const itemMap = new Map();
          symbols.forEach((symbol) => {
            const item = marketSyncJobRepository.createJobItem({
              jobId: job.id,
              symbolCode: symbol.stockCode,
              quoteCode: symbol.stockCode,
              symbolType,
              market: 'A',
              timeframe,
              rangeStart: startDay,
              rangeEnd: endDay,
              status: 'running',
              startedAt: nowLocalDateTime(),
            });
            itemMap.set(symbol.stockCode, { itemId: item.id, symbol });
          });

          const batchResult = await stockDataService.syncDailyBarsByTradeDay({
            stockCodes: symbols.map((item) => item.stockCode),
            tradeDay: startDay,
          });

          symbols.forEach((symbol) => {
            const row = batchResult?.byStockCode?.[symbol.stockCode] || null;
            const written = Number(row?.writtenBars || 0);
            const message = String(row?.error || '').trim();
            const itemMeta = itemMap.get(symbol.stockCode);

            if (written > 0) {
              writtenBars += written;
              if (!firstSyncedDay || startDay < firstSyncedDay) firstSyncedDay = startDay;
              if (!lastSyncedDay || startDay > lastSyncedDay) lastSyncedDay = startDay;
              success.push({
                stockCode: symbol.stockCode,
                symbolName: symbol.name || '',
                fetchedCandles: written,
                writtenBars: written,
                firstDay: startDay,
                lastDay: startDay,
              });
              marketSyncJobRepository.updateJobItem(itemMeta.itemId, {
                status: 'success',
                barsWritten: written,
                sourceProvider: row?.sourceProvider || 'tushare.daily',
                finishedAt: nowLocalDateTime(),
              });
              return;
            }

            if (message) {
              failed.push({
                stockCode: symbol.stockCode,
                symbolName: symbol.name || '',
                message,
              });
              marketSyncJobRepository.updateJobItem(itemMeta.itemId, {
                status: 'failed',
                errorCode: 'SYNC_STOCK_FAILED',
                errorMessage: message,
                finishedAt: nowLocalDateTime(),
              });
              return;
            }

            success.push({
              stockCode: symbol.stockCode,
              symbolName: symbol.name || '',
              fetchedCandles: 0,
              writtenBars: 0,
              firstDay: null,
              lastDay: null,
            });
            marketSyncJobRepository.updateJobItem(itemMeta.itemId, {
              status: 'success',
              barsWritten: 0,
              sourceProvider: 'tushare.daily',
              finishedAt: nowLocalDateTime(),
            });
          });

          const result = {
            ok: failed.length === 0,
            symbolType,
            timeframe,
            syncRange,
            startDay,
            endDay,
            firstSyncedDay,
            lastSyncedDay,
            stockCode: String(payload.stockCode || payload.quoteCode || '').trim().toUpperCase(),
            earliestAllowedDay,
            maxLookbackDays: rule.maxDays,
            symbolTotal: symbols.length,
            successSymbols: success.length,
            ...summarizeSyncOutcome(success, failed),
            writtenBars,
            success,
            failed,
            jobId: job.id,
          };

          marketSyncJobRepository.updateJob(job.id, {
            status: failed.length ? (success.length ? 'partial_failed' : 'failed') : 'success',
            finishedAt: nowLocalDateTime(),
            summaryJson: JSON.stringify(result),
          });

          return result;
        }

        for (const symbol of symbols) {
          const item = marketSyncJobRepository.createJobItem({
            jobId: job.id,
            symbolCode: symbol.stockCode,
            quoteCode: symbol.stockCode,
            symbolType,
            market: 'A',
            timeframe,
            rangeStart: startDay,
            rangeEnd: endDay,
            status: 'running',
            startedAt: nowLocalDateTime(),
          });

          try {
            let lastError = null;
            for (let attempt = 0; attempt <= STOCK_DAILY_SYNC_MAX_RETRIES; attempt += 1) {
              try {
                await stockDataService.getHistory(symbol.stockCode, {
                  days: Math.max(daySpan + 30, 180),
                  localMode: 'coverage_first',
                  coverageTargetDay: endDay,
                  coverageRequireOfficial: true,
                });
                lastError = null;
                break;
              } catch (error) {
                lastError = error;
                if (!isTushareRateLimitError(error) || attempt >= STOCK_DAILY_SYNC_MAX_RETRIES) {
                  throw error;
                }
                await sleep((attempt + 1) * 2500);
              }
            }
            if (lastError) {
              throw lastError;
            }
            const rows = stockBarsRepository.listEodBars({
              stockCode: symbol.stockCode,
              timeframe: '1d',
              startDay,
              endDay,
              limit: Math.max(daySpan * 2, 400),
            });
            const written = rows.length;
            writtenBars += written;

            const firstDay = rows[0]?.tradeDay || null;
            const lastDay = rows[rows.length - 1]?.tradeDay || null;
            if (firstDay && (!firstSyncedDay || firstDay < firstSyncedDay)) firstSyncedDay = firstDay;
            if (lastDay && (!lastSyncedDay || lastDay > lastSyncedDay)) lastSyncedDay = lastDay;

            success.push({
              stockCode: symbol.stockCode,
              symbolName: symbol.name || '',
              fetchedCandles: written,
              writtenBars: written,
              firstDay,
              lastDay,
            });

            marketSyncJobRepository.updateJobItem(item.id, {
              status: 'success',
              barsWritten: written,
              sourceProvider: 'stockDataService.getHistory',
              finishedAt: nowLocalDateTime(),
            });
          } catch (error) {
            const message = String(error?.message || '未知错误');
            failed.push({
              stockCode: symbol.stockCode,
              symbolName: symbol.name || '',
              message,
            });
            marketSyncJobRepository.updateJobItem(item.id, {
              status: 'failed',
              errorCode: 'SYNC_STOCK_FAILED',
              errorMessage: message,
              finishedAt: nowLocalDateTime(),
            });
          }
        }

        const result = {
          ok: failed.length === 0,
          symbolType,
          timeframe,
          syncRange,
          startDay,
          endDay,
          firstSyncedDay,
          lastSyncedDay,
          stockCode: String(payload.stockCode || payload.quoteCode || '').trim().toUpperCase(),
          earliestAllowedDay,
          maxLookbackDays: rule.maxDays,
          symbolTotal: symbols.length,
          successSymbols: success.length,
          ...summarizeSyncOutcome(success, failed),
          writtenBars,
          success,
          failed,
          jobId: job.id,
        };

        marketSyncJobRepository.updateJob(job.id, {
          status: failed.length ? (success.length ? 'partial_failed' : 'failed') : 'success',
          finishedAt: nowLocalDateTime(),
          summaryJson: JSON.stringify(result),
        });

        return result;
      }

      const symbols = resolveFuturesSymbolsForSync(payload.quoteCode);

      for (const symbol of symbols) {
        const item = marketSyncJobRepository.createJobItem({
          jobId: job.id,
          symbolCode: String(symbol.quoteCode || '').split('.').pop() || symbol.quoteCode,
          quoteCode: symbol.quoteCode,
          symbolType,
          market: String(symbol.quoteCode || '').split('.')[0] || null,
          timeframe,
          rangeStart: startDay,
          rangeEnd: endDay,
          status: 'running',
          startedAt: nowLocalDateTime(),
        });

        try {
          const normalized = normalizeQuoteCode(symbol.quoteCode);
          const candles = await fetchKlineHistory({
            secid: normalized.secid,
            klt: rule.klt,
            startDay,
            endDay,
            lmt,
          });
          const bars = candlesToBars(candles, startDay, endDay, 'eastmoney.push2his');
          const written = timeframe === '1m'
            ? futuresRepository.upsertIntradayBars({
              quoteCode: normalized.quoteCode,
              timeframe,
              bars,
            })
            : futuresRepository.upsertEodBars({
              quoteCode: normalized.quoteCode,
              timeframe,
              bars,
            });

          const firstBarDay = bars[0]?.tradeDay || null;
          const lastBarDay = bars[bars.length - 1]?.tradeDay || null;
          if (firstBarDay && (!firstSyncedDay || firstBarDay < firstSyncedDay)) firstSyncedDay = firstBarDay;
          if (lastBarDay && (!lastSyncedDay || lastBarDay > lastSyncedDay)) lastSyncedDay = lastBarDay;

          writtenBars += written;
          success.push({
            quoteCode: normalized.quoteCode,
            symbolName: symbol.name || '',
            fetchedCandles: candles.length,
            writtenBars: written,
            firstDay: firstBarDay,
            lastDay: lastBarDay,
          });

          marketSyncJobRepository.updateJobItem(item.id, {
            status: 'success',
            barsWritten: written,
            sourceProvider: 'eastmoney.push2his',
            finishedAt: nowLocalDateTime(),
          });
        } catch (error) {
          const message = String(error?.message || '未知错误');
          failed.push({
            quoteCode: symbol.quoteCode,
            symbolName: symbol.name || '',
            message,
          });
          marketSyncJobRepository.updateJobItem(item.id, {
            status: 'failed',
            errorCode: 'SYNC_FUTURES_FAILED',
            errorMessage: message,
            finishedAt: nowLocalDateTime(),
          });
        }
      }

      const result = {
        ok: failed.length === 0,
        symbolType,
        timeframe,
        syncRange,
        startDay,
        endDay,
        firstSyncedDay,
        lastSyncedDay,
        quoteCode: String(payload.quoteCode || '').trim().toUpperCase(),
        earliestAllowedDay,
        maxLookbackDays: rule.maxDays,
        symbolTotal: symbols.length,
        successSymbols: success.length,
        ...summarizeSyncOutcome(success, failed),
        writtenBars,
        success,
        failed,
        jobId: job.id,
      };

      marketSyncJobRepository.updateJob(job.id, {
        status: failed.length ? (success.length ? 'partial_failed' : 'failed') : 'success',
        finishedAt: nowLocalDateTime(),
        summaryJson: JSON.stringify(result),
      });

      return result;
    } catch (error) {
      marketSyncJobRepository.updateJob(job.id, {
        status: 'failed',
        finishedAt: nowLocalDateTime(),
        summaryJson: JSON.stringify({ error: String(error?.message || error) }),
      });
      throw error;
    }
  },

  listSyncJobs(payload = {}) {
    const result = marketSyncJobRepository.listJobs({
      page: payload.page,
      limit: payload.limit,
      status: payload.status,
      jobType: payload.jobType,
    });

    const nowMs = Date.now();

    return {
      ...result,
      items: result.items.map((item) => {
        let job = { ...item };
        let details = marketSyncJobRepository.listJobItems(item.id);
        let progress = calcSyncJobProgress(details);
        let repaired = false;
        const statusText = String(job.status || '').trim().toLowerCase();
        const isActiveStatus = statusText === 'running' || statusText === 'queued';

        if (isActiveStatus) {
          if (progress.totalItems > 0 && progress.doneItems >= progress.totalItems) {
            const terminalStatus = resolveTerminalStatusByProgress(progress);
            job = marketSyncJobRepository.updateJob(job.id, {
              status: terminalStatus,
              finishedAt: nowLocalDateTime(),
            }) || job;
            repaired = true;
          } else {
            const lastActivityMs = calcSyncJobLastActivityMs(job, details);
            const staleMs = SYNC_JOB_STALE_MINUTES * 60 * 1000;
            const isStale = Number.isFinite(lastActivityMs) && (nowMs - lastActivityMs >= staleMs);
            if (isStale) {
              const stuckItems = details.filter((entry) => {
                const entryStatus = String(entry.status || '').trim().toLowerCase();
                return entryStatus === 'running' || entryStatus === 'queued';
              });
              const message = `任务疑似异常中断（超过${SYNC_JOB_STALE_MINUTES}分钟无活动），系统自动收口`;
              stuckItems.forEach((entry) => {
                marketSyncJobRepository.updateJobItem(entry.id, {
                  status: 'failed',
                  errorCode: 'SYNC_JOB_STALE',
                  errorMessage: message,
                  finishedAt: nowLocalDateTime(),
                });
              });

              details = marketSyncJobRepository.listJobItems(job.id);
              progress = calcSyncJobProgress(details);
              const terminalStatus = progress.totalItems > 0
                ? resolveTerminalStatusByProgress(progress)
                : 'failed';
              job = marketSyncJobRepository.updateJob(job.id, {
                status: terminalStatus,
                finishedAt: nowLocalDateTime(),
                summaryJson: JSON.stringify({
                  staleRecovered: true,
                  message,
                  recoveredAt: nowLocalDateTime(),
                }),
              }) || job;
              repaired = true;
            }
          }
        }

        if (repaired) {
          details = marketSyncJobRepository.listJobItems(job.id);
          progress = calcSyncJobProgress(details);
        }

        return {
          ...job,
          details,
          progress,
        };
      }),
    };
  },

  listQualityReports(payload = {}) {
    return {
      items: marketQualityRepository.listReports({
        datasetName: payload.datasetName,
        timeframe: payload.timeframe,
        scopeType: payload.scopeType,
        limit: payload.limit,
      }),
    };
  },

  queryFuturesIntraday(payload = {}) {
    return this.queryMarketData({
      ...payload,
      symbolType: 'futures',
    });
  },

  async syncFuturesIntraday(payload = {}) {
    return this.syncMarketData({
      ...payload,
      symbolType: 'futures',
    });
  },
};

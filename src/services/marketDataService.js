import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { futuresRepository } from '../repositories/futuresRepository.js';
import { HttpError } from '../utils/httpError.js';

const FUTURES_HISTORY_UT = 'fa5fd1943c7b386f172d6893dbfba10b';
const execFileAsync = promisify(execFile);

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

const SYNCABLE_TIMEFRAME_RULES = {
  '1m': { klt: '1', periodDays: 1 / 1440, maxDays: 7, maxLmt: 20000, label: '分钟' },
  '1d': { klt: '101', periodDays: 1, maxDays: 365 * 3, maxLmt: 8000, label: '日' },
  '1w': { klt: '102', periodDays: 7, maxDays: 365 * 10, maxLmt: 8000, label: '周' },
  '1M': { klt: '103', periodDays: 30, maxDays: 365 * 20, maxLmt: 8000, label: '月' },
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
  const lastTsByQuote = new Map();
  const normalizedOrder = String(order || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  return items.map((item) => {
    const currentTs = Number(item.bucketTs);
    let gapSeconds = null;
    let gapBars = 0;
    const quoteCode = String(item.quoteCode || '').trim().toUpperCase();
    const prevTs = lastTsByQuote.get(quoteCode);
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
    lastTsByQuote.set(quoteCode, currentTs);
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

function dedupeSymbols(items = []) {
  return Array.from(new Map(
    (items || []).map((item) => [String(item.quoteCode || '').trim().toUpperCase(), item]),
  ).values()).filter((item) => item.quoteCode);
}

function resolveSymbolsForSync(quoteCodeFilter = '') {
  const configured = dedupeSymbols(
    futuresRepository.listSymbols({ onlyActive: true }).map((item) => ({
      quoteCode: String(item.quoteCode || '').trim().toUpperCase(),
      name: item.name || '',
    })),
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
    matched.push({
      quoteCode: normalized.quoteCode,
      name: normalized.code,
    });
  }

  const output = dedupeSymbols(matched);
  if (!output.length) {
    throw new HttpError(404, `未匹配到可同步品种: ${quoteCodeFilter}`);
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

function summarizeSymbols(rows = [], intervalSeconds) {
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
      quoteCode: row.quoteCode,
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

export const marketDataService = {
  queryFuturesIntraday(payload = {}) {
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
    if (!startDay && !endDay) {
      return {
        dataset: 'futures_intraday_bars',
        filters: {
          timeframe,
          tradeDay: null,
          startDay: null,
          endDay: null,
          quoteCode,
          page,
          limit,
        },
        pagination: {
          page,
          limit,
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
    }

    const total = futuresRepository.countIntradayBarsForReview({
      timeframe,
      tradeDay,
      startDay,
      endDay,
      quoteCode,
    });
    const rawItems = futuresRepository.listIntradayBarsForReview({
      timeframe,
      tradeDay,
      startDay,
      endDay,
      quoteCode,
      page,
      limit,
    });
    const items = attachGapMetrics(rawItems, intervalSeconds, 'desc');

    const overviewRows = futuresRepository.listIntradaySymbolsOverview({
      timeframe,
      tradeDay,
      startDay,
      endDay,
      quoteCode,
      limit: 500,
    });
    const { symbols, summary } = summarizeSymbols(overviewRows, intervalSeconds);

    return {
      dataset: 'futures_intraday_bars',
      filters: {
        timeframe,
        tradeDay,
        startDay,
        endDay,
        quoteCode,
        page,
        limit,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: total > 0 ? Math.ceil(total / limit) : 0,
      },
      summary,
      symbols,
      items,
    };
  },

  async syncFuturesIntraday(payload = {}) {
    const timeframe = normalizeMarketDataTimeframe(payload.timeframe || '1m');
    const rule = SYNCABLE_TIMEFRAME_RULES[timeframe];
    if (!rule) {
      const supported = Object.entries(SYNCABLE_TIMEFRAME_RULES)
        .map(([key, item]) => `${item.label}(${key})`)
        .join(', ');
      throw new HttpError(
        400,
        `当前仅支持 ${supported} 的手动同步`,
      );
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
    const earliestAllowedDay = formatLocalDate(addDays(new Date(), -(rule.maxDays - 1)));
    if (startDay < earliestAllowedDay) {
      throw new HttpError(
        400,
        `${rule.label}粒度最早仅支持同步到 ${earliestAllowedDay}，以避免过量历史加载`,
      );
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

    const symbols = resolveSymbolsForSync(payload.quoteCode);
    const success = [];
    const failed = [];
    let writtenBars = 0;
    let firstSyncedDay = null;
    let lastSyncedDay = null;

    for (const symbol of symbols) {
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
        const written = futuresRepository.upsertIntradayBars({
          quoteCode: normalized.quoteCode,
          timeframe,
          bars,
        });
        const firstBarDay = bars[0]?.tradeDay || null;
        const lastBarDay = bars[bars.length - 1]?.tradeDay || null;
        if (firstBarDay && (!firstSyncedDay || firstBarDay < firstSyncedDay)) {
          firstSyncedDay = firstBarDay;
        }
        if (lastBarDay && (!lastSyncedDay || lastBarDay > lastSyncedDay)) {
          lastSyncedDay = lastBarDay;
        }

        writtenBars += written;
        success.push({
          quoteCode: normalized.quoteCode,
          symbolName: symbol.name || '',
          fetchedCandles: candles.length,
          writtenBars: written,
          firstDay: firstBarDay,
          lastDay: lastBarDay,
        });
      } catch (error) {
        failed.push({
          quoteCode: symbol.quoteCode,
          symbolName: symbol.name || '',
          message: String(error?.message || '未知错误'),
        });
      }
    }

    return {
      ok: failed.length === 0,
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
      failedSymbols: failed.length,
      writtenBars,
      success,
      failed,
    };
  },
};

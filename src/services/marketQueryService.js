import { stockBarsRepository } from '../repositories/stockBarsRepository.js';
import { futuresRepository } from '../repositories/futuresRepository.js';
import { stockDataService } from './stockDataService.js';
import { marketFreshnessPolicyService } from './marketFreshnessPolicyService.js';

const INTRADAY_BASE_SECONDS = {
  '30s': 30,
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '60m': 3600,
};

const EOD_TFS = new Set(['1d', '1w', '1M', '1Y']);

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatDateFromTs(ts) {
  const d = new Date(Number(ts) * 1000);
  if (!Number.isFinite(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function normalizeTradeDay(value = '') {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return '';
}

function parseTradeDayToMs(value = '') {
  const day = normalizeTradeDay(value);
  if (!day) return null;
  const ms = Date.parse(`${day}T00:00:00+08:00`);
  return Number.isFinite(ms) ? ms : null;
}

function toBucketTsFromTradeDay(value = '') {
  const ms = parseTradeDayToMs(value);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

function groupMinuteBars(rows = [], targetSeconds = 300) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const map = new Map();

  rows.forEach((row) => {
    const bucketTs = Number(row.bucketTs);
    if (!Number.isFinite(bucketTs)) return;
    const groupTs = Math.floor(bucketTs / targetSeconds) * targetSeconds;
    const open = toNum(row.open);
    const high = toNum(row.high);
    const low = toNum(row.low);
    const close = toNum(row.close);
    if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) return;

    const prev = map.get(groupTs);
    if (!prev) {
      map.set(groupTs, {
        ...row,
        bucketTs: groupTs,
        tradeDay: normalizeTradeDay(row.tradeDay || row.date),
        date: formatDateFromTs(groupTs),
        open,
        high,
        low,
        close,
        vol: toNum(row.vol, toNum(row.volume, 0)),
        volume: toNum(row.volume, toNum(row.vol, 0)),
        amount: toNum(row.amount, 0),
      });
      return;
    }

    prev.high = Math.max(prev.high, high);
    prev.low = Math.min(prev.low, low);
    prev.close = close;
    prev.vol = toNum(prev.vol, 0) + toNum(row.vol, toNum(row.volume, 0));
    prev.volume = toNum(prev.volume, 0) + toNum(row.volume, toNum(row.vol, 0));
    prev.amount = toNum(prev.amount, 0) + toNum(row.amount, 0);
    prev.date = formatDateFromTs(groupTs);
    prev.tradeDay = normalizeTradeDay(prev.tradeDay || row.tradeDay || row.date);
  });

  return Array.from(map.values()).sort((a, b) => a.bucketTs - b.bucketTs);
}

function getWeekKey(ms) {
  const d = new Date(ms);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  d.setHours(0, 0, 0, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dayText = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dayText}`;
}

function getMonthKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getYearKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}`;
}

function groupEodBars(rows = [], timeframe = '1w') {
  if (!Array.isArray(rows) || !rows.length) return [];
  const map = new Map();

  rows.forEach((row) => {
    const dayMs = parseTradeDayToMs(row.tradeDay || row.date);
    if (!Number.isFinite(dayMs)) return;

    let key = '';
    if (timeframe === '1w') key = getWeekKey(dayMs);
    if (timeframe === '1M') key = getMonthKey(dayMs);
    if (timeframe === '1Y') key = getYearKey(dayMs);
    if (!key) return;

    const open = toNum(row.open);
    const high = toNum(row.high);
    const low = toNum(row.low);
    const close = toNum(row.close);
    if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) return;

    const currentTradeDay = normalizeTradeDay(row.tradeDay || row.date);
    const currentBucketTs = Number(row.bucketTs) || toBucketTsFromTradeDay(currentTradeDay) || 0;
    const prev = map.get(key);

    if (!prev) {
      map.set(key, {
        ...row,
        timeframe,
        tradeDay: currentTradeDay,
        bucketTs: currentBucketTs,
        date: currentTradeDay,
        open,
        high,
        low,
        close,
        vol: toNum(row.vol, toNum(row.volume, 0)),
        volume: toNum(row.volume, toNum(row.vol, 0)),
        amount: toNum(row.amount, 0),
      });
      return;
    }

    prev.high = Math.max(prev.high, high);
    prev.low = Math.min(prev.low, low);
    prev.close = close;
    prev.vol = toNum(prev.vol, 0) + toNum(row.vol, toNum(row.volume, 0));
    prev.volume = toNum(prev.volume, 0) + toNum(row.volume, toNum(row.vol, 0));
    prev.amount = toNum(prev.amount, 0) + toNum(row.amount, 0);

    if (currentBucketTs >= Number(prev.bucketTs || 0)) {
      prev.tradeDay = currentTradeDay;
      prev.bucketTs = currentBucketTs;
      prev.date = currentTradeDay;
    }
  });

  return Array.from(map.values()).sort((a, b) => a.bucketTs - b.bucketTs);
}

async function loadStockEodBase(stockCode, { startDay, endDay, limit = 600, allowRefresh = true } = {}) {
  let base = stockBarsRepository.listEodBars({
    stockCode,
    timeframe: '1d',
    startDay,
    endDay,
    limit,
  });

  if (!base.length && allowRefresh) {
    const days = Math.max(120, Number(limit) || 240);
    await stockDataService.getHistory(stockCode, { days });
    base = stockBarsRepository.listEodBars({
      stockCode,
      timeframe: '1d',
      startDay,
      endDay,
      limit,
    });
  }

  return base;
}

async function queryStockSeries({ symbol, timeframe, startDay, endDay, limit, allowRefresh = true } = {}) {
  if (timeframe in INTRADAY_BASE_SECONDS) {
    if (timeframe === '1m') {
      const rows = stockBarsRepository.listIntradayBars({ stockCode: symbol, timeframe: '1m', startDay, endDay, limit });
      return { rows, source: 'stock_intraday_bars', baseTimeframe: '1m' };
    }

    const stored = stockBarsRepository.listIntradayBars({ stockCode: symbol, timeframe, startDay, endDay, limit });
    if (stored.length) {
      return { rows: stored, source: 'stock_intraday_bars', baseTimeframe: timeframe };
    }

    const base = stockBarsRepository.listIntradayBars({ stockCode: symbol, timeframe: '1m', startDay, endDay, limit: Math.max(limit * 6, 2400) });
    if (!base.length) return { rows: [], source: 'stock_intraday_bars', baseTimeframe: '1m' };

    return {
      rows: groupMinuteBars(base, INTRADAY_BASE_SECONDS[timeframe]),
      source: 'stock_intraday_bars.derived',
      baseTimeframe: '1m',
    };
  }

  if (!EOD_TFS.has(timeframe)) {
    return { rows: [], source: 'stock_eod_bars', baseTimeframe: '1d' };
  }

  if (timeframe === '1d') {
    const rows = await loadStockEodBase(symbol, { startDay, endDay, limit, allowRefresh });
    return { rows, source: 'stock_eod_bars', baseTimeframe: '1d' };
  }

  const stored = stockBarsRepository.listEodBars({ stockCode: symbol, timeframe, startDay, endDay, limit });
  if (stored.length) {
    return { rows: stored, source: 'stock_eod_bars', baseTimeframe: timeframe };
  }

  const base = await loadStockEodBase(symbol, {
    startDay,
    endDay,
    limit: Math.max(limit * 6, 600),
    allowRefresh,
  });
  if (!base.length) return { rows: [], source: 'stock_eod_bars', baseTimeframe: '1d' };

  return {
    rows: groupEodBars(base, timeframe),
    source: 'stock_eod_bars.derived',
    baseTimeframe: '1d',
  };
}

async function queryFuturesSeries({ symbol, timeframe, startDay, endDay, limit } = {}) {
  if (timeframe in INTRADAY_BASE_SECONDS) {
    if (timeframe === '1m') {
      return {
        rows: futuresRepository.listIntradayBarsByRange({ quoteCode: symbol, timeframe: '1m', startDay, endDay, limit }),
        source: 'futures_intraday_bars',
        baseTimeframe: '1m',
      };
    }

    const stored = futuresRepository.listIntradayBarsByRange({ quoteCode: symbol, timeframe, startDay, endDay, limit });
    if (stored.length) {
      return {
        rows: stored,
        source: 'futures_intraday_bars',
        baseTimeframe: timeframe,
      };
    }

    const base = futuresRepository.listIntradayBarsByRange({ quoteCode: symbol, timeframe: '1m', startDay, endDay, limit: Math.max(limit * 6, 2400) });
    if (!base.length) return { rows: [], source: 'futures_intraday_bars', baseTimeframe: '1m' };
    return {
      rows: groupMinuteBars(base, INTRADAY_BASE_SECONDS[timeframe]),
      source: 'futures_intraday_bars.derived',
      baseTimeframe: '1m',
    };
  }

  if (!EOD_TFS.has(timeframe)) {
    return { rows: [], source: 'futures_eod_bars', baseTimeframe: '1d' };
  }

  if (timeframe === '1d') {
    return {
      rows: futuresRepository.listEodBars({ quoteCode: symbol, timeframe: '1d', startDay, endDay, limit }),
      source: 'futures_eod_bars',
      baseTimeframe: '1d',
    };
  }

  const stored = futuresRepository.listEodBars({ quoteCode: symbol, timeframe, startDay, endDay, limit });
  if (stored.length) {
    return {
      rows: stored,
      source: 'futures_eod_bars',
      baseTimeframe: timeframe,
    };
  }

  const base = futuresRepository.listEodBars({ quoteCode: symbol, timeframe: '1d', startDay, endDay, limit: Math.max(limit * 6, 600) });
  if (!base.length) return { rows: [], source: 'futures_eod_bars', baseTimeframe: '1d' };

  return {
    rows: groupEodBars(base, timeframe),
    source: 'futures_eod_bars.derived',
    baseTimeframe: '1d',
  };
}

function normalizeRows(rows = []) {
  return (rows || []).map((row) => ({
    ...row,
    tradeDay: normalizeTradeDay(row.tradeDay || row.date),
    bucketTs: Number(row.bucketTs) || toBucketTsFromTradeDay(row.tradeDay || row.date) || 0,
    date: row.date || normalizeTradeDay(row.tradeDay),
    open: toNum(row.open),
    high: toNum(row.high),
    low: toNum(row.low),
    close: toNum(row.close),
    volume: toNum(row.volume, toNum(row.vol, 0)),
    vol: toNum(row.vol, toNum(row.volume, 0)),
    amount: toNum(row.amount, 0),
  })).filter((row) => Number.isFinite(row.bucketTs) && Number.isFinite(row.close));
}

export const marketQueryService = {
  async querySeries({
    symbolType = 'stock',
    symbol = '',
    timeframe = '1d',
    startDay = '',
    endDay = '',
    limit = 240,
    allowRefresh = true,
  } = {}) {
    const normalizedType = String(symbolType || 'stock').trim().toLowerCase();
    const normalizedSymbol = String(symbol || '').trim().toUpperCase();
    const tf = String(timeframe || '1d').trim();
    const normalizedLimit = Math.min(Math.max(Number(limit) || 240, 1), 50000);

    if (!normalizedSymbol) {
      return {
        rows: [],
        source: 'none',
        freshness: 'missing',
        warning: 'empty_symbol',
      };
    }

    let queried = { rows: [], source: 'none', baseTimeframe: tf };
    if (normalizedType === 'futures') {
      queried = await queryFuturesSeries({
        symbol: normalizedSymbol,
        timeframe: tf,
        startDay,
        endDay,
        limit: normalizedLimit,
      });
    } else {
      queried = await queryStockSeries({
        symbol: normalizedSymbol,
        timeframe: tf,
        startDay,
        endDay,
        limit: normalizedLimit,
        allowRefresh,
      });
    }

    const rows = normalizeRows(queried.rows);
    const latest = rows.length ? rows[rows.length - 1] : null;
    const freshnessResult = marketFreshnessPolicyService.evaluate({
      timeframe: tf,
      latestBucketTs: latest?.bucketTs || null,
      latestTradeDay: latest?.tradeDay || '',
    });

    return {
      symbolType: normalizedType,
      symbol: normalizedSymbol,
      timeframe: tf,
      source: queried.source,
      baseTimeframe: queried.baseTimeframe,
      rows,
      freshness: freshnessResult.freshness,
      freshnessReason: freshnessResult.reason,
      freshnessAgeSeconds: freshnessResult.ageSeconds,
      warning: rows.length ? null : 'no_local_rows',
    };
  },
};

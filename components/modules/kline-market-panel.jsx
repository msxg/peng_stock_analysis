'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react';
import { CandlestickChart, RefreshCw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PriceVolumeChart } from '@/components/charts/price-volume-chart';
import { clientApi } from '@/lib/client-api';

const STOCK_TIMEFRAMES = [
  { key: '1m', label: '分时' },
  { key: '1d', label: '日K' },
  { key: '1w', label: '周K' },
  { key: '1M', label: '月K' },
];

const FUTURES_TIMEFRAME_FALLBACK = [
  { key: '30s', label: '30秒' },
  { key: '1m', label: '1分钟' },
  { key: '5m', label: '5分钟' },
  { key: '15m', label: '15分钟' },
  { key: '30m', label: '30分钟' },
  { key: '60m', label: '60分钟' },
  { key: '1d', label: '日K' },
  { key: '1w', label: '周K' },
  { key: '1M', label: '月K' },
];

const STOCK_INDEX_PRESET_ITEMS = [
  {
    stockCode: 'SH000001',
    market: 'A',
    name: '上证指数',
    aliases: ['上证', '上证综指', '上证指数', 'SSE', 'SHCOMP', '000001.SH', 'SH000001'],
    source: 'index.preset',
  },
  {
    stockCode: 'SZ399001',
    market: 'A',
    name: '深证成指',
    aliases: ['深证', '深成指', '深证成指', '399001.SZ', 'SZ399001'],
    source: 'index.preset',
  },
  {
    stockCode: 'SZ399006',
    market: 'A',
    name: '创业板指',
    aliases: ['创业板', '创业板指', '399006.SZ', 'SZ399006'],
    source: 'index.preset',
  },
];

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatNum(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(digits);
}

function formatSigned(value, digits = 2, suffix = '') {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}${suffix}`;
}

function formatCompact(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  if (Math.abs(n) >= 100000000) return `${(n / 100000000).toFixed(2)}亿`;
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(2)}万`;
  return Math.round(n).toLocaleString();
}

function formatTextDateTime(value) {
  const text = String(value || '').trim();
  if (!text) return '--';
  const dt = new Date(text);
  if (!Number.isNaN(dt.getTime())) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    const ss = String(dt.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
  }
  return text;
}

function formatHoverTimeLabel(value) {
  const text = String(value || '').trim();
  if (text) {
    const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (matched) {
      const mm = matched[2];
      const dd = matched[3];
      const hh = matched[4] || '00';
      const mi = matched[5] || '00';
      return `${mm}-${dd} ${hh}:${mi}`;
    }
  }

  const ts = Number(value);
  if (Number.isFinite(ts)) {
    const dt = new Date(ts * 1000);
    if (!Number.isNaN(dt.getTime())) {
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      const hh = String(dt.getHours()).padStart(2, '0');
      const mi = String(dt.getMinutes()).padStart(2, '0');
      return `${mm}-${dd} ${hh}:${mi}`;
    }
  }
  return '--';
}

function normalizeSearchToken(input = '') {
  return String(input || '').trim().toUpperCase().replace(/\s+/g, '');
}

function buildSearchTokens(item = {}) {
  const code = normalizeSearchToken(item.stockCode || item.quoteCode || item.code || '');
  const market = normalizeSearchToken(item.market || '');
  const subMarket = normalizeSearchToken(item.subMarket || '');
  const symbolType = normalizeSearchToken(item.symbolType || item.type || '');
  const name = String(item.name || '').trim();
  const rawAliases = Array.isArray(item.aliases) ? item.aliases : [];
  const aliases = rawAliases.map((alias) => String(alias || '').trim()).filter(Boolean);
  const tokens = new Set();

  if (code) {
    tokens.add(code);
    tokens.add(code.replace(/[.\-]/g, ''));
    const aShareMatch = code.match(/^(SH|SZ)(\d{6})$/);
    if (aShareMatch) {
      tokens.add(aShareMatch[2]);
      tokens.add(`${aShareMatch[2]}.${aShareMatch[1]}`);
    }
  }

  if (name) {
    tokens.add(name);
    tokens.add(normalizeSearchToken(name));
  }

  aliases.forEach((alias) => {
    tokens.add(alias);
    tokens.add(normalizeSearchToken(alias));
  });

  if (market && code) {
    tokens.add(`${market}${code}`);
    tokens.add(`${market}.${code}`);
  }
  if (subMarket && code) {
    tokens.add(`${subMarket}${code}`);
    tokens.add(`${subMarket}.${code}`);
  }
  if (symbolType) {
    tokens.add(symbolType);
    if (symbolType === 'STOCK') tokens.add('股票');
    if (symbolType === 'FUTURES') tokens.add('期货');
  }

  return Array.from(tokens)
    .map((token) => String(token || '').trim())
    .filter(Boolean);
}

function includesSearchKeyword(item, keyword = '') {
  const query = normalizeSearchToken(keyword);
  if (!query) return true;
  const tokens = buildSearchTokens(item);
  return tokens.some((token) => normalizeSearchToken(token).includes(query));
}

function mergeAndDedupeSearchItems(items = []) {
  const map = new Map();
  items.forEach((item, index) => {
    const stockCode = String(item?.stockCode || item?.quoteCode || item?.code || '').trim().toUpperCase();
    if (!stockCode) return;
    const symbolType = String(item?.symbolType || item?.type || 'stock').trim().toLowerCase() === 'futures'
      ? 'futures'
      : 'stock';
    const market = String(item?.market || item?.exchange || '').trim().toUpperCase() || 'UNKNOWN';
    const key = `${symbolType}:${stockCode}`;
    if (map.has(key)) return;
    map.set(key, {
      id: item?.id || `${stockCode}-${index}`,
      stockCode,
      name: String(item?.name || stockCode).trim() || stockCode,
      market,
      subMarket: String(item?.subMarket || '').trim().toUpperCase(),
      symbolType,
      aliases: Array.isArray(item?.aliases) ? item.aliases : [],
      source: item?.source || 'search',
    });
  });
  return Array.from(map.values());
}

function normalizeCodeInput(input = '') {
  const raw = String(input || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!raw) return '';

  let match = raw.match(/^(\d{6})\.(SH|SZ)$/);
  if (match) return `${match[2]}${match[1]}`;

  match = raw.match(/^(SH|SZ)\.?(\d{6})$/);
  if (match) return `${match[1]}${match[2]}`;

  match = raw.match(/^(\d{5})\.HK$/);
  if (match) return `HK${match[1]}`;

  match = raw.match(/^HK\.?(\d{5})$/);
  if (match) return `HK${match[1]}`;

  return raw;
}

function inferMarketTypeFromCode(input = '') {
  const code = String(input || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!code) return 'stock';
  if (/^(\d{6}|\d{6}\.(SH|SZ)|SH\d{6}|SZ\d{6}|HK\d{5}|\d{5}\.HK)$/.test(code)) return 'stock';
  if (/^\d{2,3}[._-][A-Z0-9]+$/.test(code)) return 'futures';
  if (/^[A-Z]{1,3}\d{3,4}$/.test(code)) return 'futures';
  if (/^[A-Z]{1,3}$/.test(code)) return 'futures';
  return 'stock';
}

function calcStockLimitPct({ code = '', name = '' } = {}) {
  const codeText = String(code || '').trim().toUpperCase();
  const coreCode = codeText.replace(/^(SH|SZ|BJ)/, '').replace(/\..*$/, '');
  const nameText = String(name || '').trim().toUpperCase();

  if (nameText.includes('ST')) return 5;
  if (/^(300|301|688|689)/.test(coreCode)) return 20;
  if (/^(4|8)/.test(coreCode) || codeText.startsWith('BJ')) return 30;
  return 10;
}

function calcStockLimitPrices({ prevClose = null, code = '', name = '' } = {}) {
  const base = toNum(prevClose);
  if (!Number.isFinite(base) || base <= 0) return { limitUp: null, limitDown: null, limitPct: null };
  const pct = calcStockLimitPct({ code, name });
  const factor = pct / 100;
  const limitUp = Number((base * (1 + factor)).toFixed(2));
  const limitDown = Number((base * (1 - factor)).toFixed(2));
  return { limitUp, limitDown, limitPct: pct };
}

function looksLikeFuturesCode(input = '') {
  const code = String(input || '').trim().toUpperCase().replace(/\s+/g, '');
  return /^\d{2,3}[._-][A-Z0-9]+$/.test(code) || /^[A-Z]{1,3}\d{3,4}$/.test(code) || /^[A-Z]{1,3}$/.test(code);
}

function parseLocalDateTimeToSeconds(value = '') {
  const text = String(value || '').trim();
  if (!text) return null;
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!matched) return null;

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const hour = Number(matched[4] || 0);
  const minute = Number(matched[5] || 0);
  const second = Number(matched[6] || 0);
  const ms = new Date(year, month - 1, day, hour, minute, second).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

function mapCandlesToChartData(candles = [], { timeframe = '' } = {}) {
  const tf = String(timeframe || '').trim();
  const isIntraday = /^(\d+)(s|m)$/.test(tf);
  return (Array.isArray(candles) ? candles : [])
    .map((item) => {
      const open = toNum(item?.open);
      const high = toNum(item?.high);
      const low = toNum(item?.low);
      const close = toNum(item?.close);
      const volume = toNum(item?.volume) ?? 0;
      const dateText = String(item?.date || '').trim();

      if (![open, high, low, close].every((n) => Number.isFinite(n))) return null;
      if (!dateText) return null;

      const hasClock = /\d{2}:\d{2}/.test(dateText);
      const time = isIntraday
        ? parseLocalDateTimeToSeconds(dateText)
        : dateText.slice(0, 10);
      if (isIntraday && !hasClock) return null;
      if (!time) return null;

      return {
        time,
        open,
        high,
        low,
        close,
        amount: toNum(item?.amount) ?? null,
        dateText,
        value: volume,
      };
    })
    .filter(Boolean);
}

function keepLatestTradeDayCandles(candles = []) {
  const list = Array.isArray(candles) ? candles : [];
  if (!list.length) return [];
  const lastDateText = String(list[list.length - 1]?.date || '').trim();
  const matched = lastDateText.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!matched) return list;
  const latestTradeDay = matched[1];
  return list.filter((item) => String(item?.date || '').startsWith(latestTradeDay));
}

function aggregateDailyCandles(candles = [], timeframe = '1d') {
  const tf = String(timeframe || '1d');
  if (tf === '1d') return Array.isArray(candles) ? candles : [];

  const rows = (Array.isArray(candles) ? candles : [])
    .filter((item) => /^\d{4}-\d{2}-\d{2}/.test(String(item?.date || '')))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const buckets = new Map();
  rows.forEach((item) => {
    const close = toNum(item?.close);
    if (!Number.isFinite(close)) return;
    const date = String(item.date).slice(0, 10);
    const [yearText, monthText, dayText] = date.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return;

    const localDate = new Date(year, month - 1, day);
    if (Number.isNaN(localDate.getTime())) return;

    let bucketKey = date;
    if (tf === '1w') {
      const weekday = (localDate.getDay() + 6) % 7;
      const monday = new Date(localDate);
      monday.setDate(localDate.getDate() - weekday);
      const y = monday.getFullYear();
      const m = String(monday.getMonth() + 1).padStart(2, '0');
      const d = String(monday.getDate()).padStart(2, '0');
      bucketKey = `${y}-${m}-${d}`;
    } else if (tf === '1M') {
      const y = localDate.getFullYear();
      const m = String(localDate.getMonth() + 1).padStart(2, '0');
      bucketKey = `${y}-${m}`;
    }

    const open = toNum(item?.open) ?? close;
    const high = Math.max(toNum(item?.high) ?? close, open, close);
    const low = Math.min(toNum(item?.low) ?? close, open, close);
    const volume = toNum(item?.volume) ?? 0;

    const current = buckets.get(bucketKey);
    if (!current) {
      buckets.set(bucketKey, {
        date,
        open,
        high,
        low,
        close,
        volume,
      });
      return;
    }

    current.high = Math.max(current.high, high);
    current.low = Math.min(current.low, low);
    current.close = close;
    current.volume += volume;
    current.date = date;
  });

  return Array.from(buckets.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function buildTimeframeOptions(marketType = 'stock', futuresTimeframes = []) {
  if (marketType === 'stock') return STOCK_TIMEFRAMES;
  if (Array.isArray(futuresTimeframes) && futuresTimeframes.length) return futuresTimeframes;
  return FUTURES_TIMEFRAME_FALLBACK;
}

function getTimeframeLabel(marketType = 'stock', timeframe = '1d') {
  const items = buildTimeframeOptions(marketType, FUTURES_TIMEFRAME_FALLBACK);
  return items.find((item) => item.key === timeframe)?.label || timeframe || '--';
}

function resolveFuturesLimit(timeframe = '1m') {
  const tf = String(timeframe || '1m');
  if (tf === '1m') return 1800;
  if (tf === '1d' || tf === '1w' || tf === '1M') return 160;
  return 240;
}

function buildEmptyResult({ marketType = 'stock', timeframe = '1m', symbol = '', error = null } = {}) {
  return {
    marketType,
    symbol,
    name: '',
    timeframe,
    timeframeLabel: getTimeframeLabel(marketType, timeframe),
    quote: null,
    candles: [],
    chartData: [],
    candleDataSource: null,
    quoteDataSource: null,
    warning: null,
    error,
  };
}

function buildSnapshot(result) {
  const quote = result?.quote || null;
  if (quote) {
    const price = toNum(quote.price);
    const prevClose = toNum(quote.prevClose);
    const change = toNum(quote.change);
    const changePct = toNum(quote.changePct);
    const derivedChange = Number.isFinite(change)
      ? change
      : (Number.isFinite(price) && Number.isFinite(prevClose) ? price - prevClose : null);
    const derivedChangePct = Number.isFinite(changePct)
      ? changePct
      : (Number.isFinite(derivedChange) && Number.isFinite(prevClose) && prevClose !== 0
        ? (derivedChange / prevClose) * 100
        : null);

    return {
      close: price,
      change: derivedChange,
      changePct: derivedChangePct,
      high: toNum(quote.high),
      low: toNum(quote.low),
      open: toNum(quote.open),
      volume: toNum(quote.volume),
      amount: toNum(quote.amount),
      prevClose,
      openInterest: toNum(quote.openInterest),
      tradeTime: quote.tradeTime || quote.fetchedAt || '',
      tradingHours: quote.tradingHours || null,
    };
  }

  const candles = Array.isArray(result?.candles) ? result.candles : [];
  if (!candles.length) return null;
  const last = candles[candles.length - 1];
  const prev = candles.length > 1 ? candles[candles.length - 2] : null;
  const close = toNum(last?.close);
  const prevClose = toNum(prev?.close);
  const change = Number.isFinite(close) && Number.isFinite(prevClose) ? close - prevClose : null;
  const changePct = Number.isFinite(change) && Number.isFinite(prevClose) && prevClose !== 0
    ? (change / prevClose) * 100
    : null;

  return {
    close,
    change,
    changePct,
    high: toNum(last?.high),
    low: toNum(last?.low),
    open: toNum(last?.open),
    volume: toNum(last?.volume),
    amount: toNum(last?.amount),
    prevClose,
    openInterest: toNum(last?.openInterest),
    tradeTime: String(last?.date || ''),
    tradingHours: null,
  };
}

function buildMetrics(result, snapshot) {
  const quote = result?.quote || {};
  const isFutures = result?.marketType === 'futures';

  if (isFutures) {
    return [
      { label: '昨收', value: quote.prevClose, digits: 2 },
      { label: '开盘', value: quote.open, digits: 2 },
      { label: '最高', value: quote.high, digits: 2 },
      { label: '最低', value: quote.low, digits: 2 },
      { label: '成交量', value: quote.volume, compact: true },
      { label: '成交额', value: quote.amount, compact: true },
      { label: '持仓量', value: quote.openInterest, compact: true },
      { label: '交易时段', value: quote.tradingHours || snapshot?.tradingHours || '--' },
    ];
  }

  return [
    { label: '昨收', value: quote.prevClose, digits: 2, tone: 'price' },
    { label: '开盘', value: quote.open, digits: 2, tone: 'price' },
    { label: '最高', value: quote.high, digits: 2, tone: 'price' },
    { label: '最低', value: quote.low, digits: 2, tone: 'price' },
    { label: '成交量', value: quote.volume, compact: true },
    { label: '成交额', value: quote.amount, compact: true },
    { label: '换手', value: quote.turnoverRate, digits: 2, suffix: '%' },
    { label: '量比', value: quote.volumeRatio, digits: 2 },
    { label: '市盈率(动)', value: quote.pe, digits: 2 },
    { label: '市盈率(TTM)', value: quote.peTTM, digits: 2 },
    { label: '市净率', value: quote.pb, digits: 2 },
  ];
}

function formatMetricValue(metric) {
  const value = metric?.value;
  if (value === null || value === undefined || value === '') return '--';
  if (metric?.compact) return formatCompact(value);
  if (metric?.suffix) return formatSigned(value, metric.digits ?? 2, metric.suffix);
  if (Number.isFinite(Number(value))) return formatNum(value, metric.digits ?? 2);
  return String(value);
}

function resolveMetricValueClass(metric, result, snapshot) {
  if (result?.marketType !== 'stock') return 'text-foreground';
  if (metric?.tone !== 'price') return 'text-foreground';

  const value = toNum(metric?.value);
  const prevClose = toNum(result?.quote?.prevClose ?? snapshot?.prevClose);
  if (!Number.isFinite(value) || !Number.isFinite(prevClose)) return 'text-foreground';

  if (value > prevClose) return 'text-rose-600';
  if (value < prevClose) return 'text-emerald-600';
  return 'text-foreground';
}

export function KlineMarketPanel({ initialCode = '' }) {
  const normalizedInitialCode = useMemo(() => normalizeCodeInput(initialCode), [initialCode]);
  const inferredInitialMarketType = useMemo(
    () => inferMarketTypeFromCode(normalizedInitialCode),
    [normalizedInitialCode],
  );

  const autoLoadRef = useRef('');
  const [marketType, setMarketType] = useState(inferredInitialMarketType);
  const [code, setCode] = useState(normalizedInitialCode);
  const [timeframe, setTimeframe] = useState(inferredInitialMarketType === 'stock' ? '1m' : '1m');
  const [futuresTimeframes, setFuturesTimeframes] = useState([]);
  const [result, setResult] = useState(() => buildEmptyResult({
    marketType: inferredInitialMarketType,
    timeframe: inferredInitialMarketType === 'stock' ? '1m' : '1m',
    symbol: normalizedInitialCode,
  }));
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [futuresPresetItems, setFuturesPresetItems] = useState([]);
  const searchBlurTimerRef = useRef(null);
  const [hoveredCandle, setHoveredCandle] = useState(null);
  const [hoverPointer, setHoverPointer] = useState(null);
  const hoverTooltipRef = useRef(null);
  const [hoverTooltipSize, setHoverTooltipSize] = useState({ width: 208, height: 142 });
  const onHoverChartCandle = useCallback((item, meta = {}) => {
    setHoveredCandle(item || null);
    if (!item || !meta?.point) {
      setHoverPointer(null);
      return;
    }
    setHoverPointer({
      x: Number(meta.point.x),
      y: Number(meta.point.y),
      width: Number(meta.width),
      height: Number(meta.height),
    });
  }, []);

  const timeframeOptions = useMemo(
    () => buildTimeframeOptions(marketType, futuresTimeframes),
    [marketType, futuresTimeframes],
  );

  const setResultSafely = useCallback((payload) => {
    startTransition(() => {
      setResult(payload);
    });
  }, [startTransition]);

  useEffect(() => {
    let cancelled = false;
    async function loadTimeframes() {
      try {
        const payload = await clientApi.futures.timeframes();
        if (cancelled) return;
        setFuturesTimeframes(Array.isArray(payload?.items) ? payload.items : []);
      } catch {
        if (!cancelled) setFuturesTimeframes([]);
      }
    }
    loadTimeframes();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    if (searchBlurTimerRef.current) {
      window.clearTimeout(searchBlurTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const keyword = String(code || '').trim();
    if (!keyword || !searchFocused) {
      setSearchSuggestions([]);
      setSearchError('');
      setSearchLoading(false);
      return undefined;
    }

    setSearchLoading(true);
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearchError('');
      try {
        if (marketType === 'futures') {
          let presets = futuresPresetItems;
          if (!presets.length) {
            const presetsPayload = await clientApi.futures.presets();
            presets = Array.isArray(presetsPayload?.items)
              ? presetsPayload.items.map((item, index) => ({
                id: `futures-preset-${item.quoteCode || item.code || index}`,
                stockCode: item.quoteCode || item.code,
                quoteCode: item.quoteCode || item.code,
                name: item.name || item.quoteCode || item.code,
                market: item.exchange || 'FUTURES',
                symbolType: 'futures',
                aliases: [
                  item.exchange,
                  item.quoteCode,
                  item.code,
                  item.name,
                ].filter(Boolean),
                source: item.source || 'futures.preset',
              }))
              : [];
            if (!cancelled) {
              setFuturesPresetItems(presets);
            }
          }

          if (cancelled) return;
          const futuresItems = mergeAndDedupeSearchItems(
            presets.filter((item) => includesSearchKeyword(item, keyword)),
          );
          setSearchSuggestions(futuresItems.slice(0, 20));
          return;
        }

        const [stockBasicsPayload, fallbackSearchPayload] = await Promise.all([
          clientApi.stockBasics.suggest({ q: keyword, limit: 40 })
            .catch(() => clientApi.stockBasics.search({ q: keyword, limit: 40 })),
          clientApi.stockBasics.search({ q: keyword, limit: 20 }).catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;

        const mapStockBasic = (item = {}, index = 0, source = 'stock.basics') => ({
          id: `${source}-${item.market || ''}-${item.code || item.stockCode || ''}-${index}`,
          stockCode: item.code || item.stockCode,
          name: item.name || item.code || item.stockCode,
          market: item.market,
          subMarket: item.subMarket || '',
          symbolType: 'stock',
          aliases: [
            item.code,
            item.stockCode,
            item.name,
            item.pinyin,
            ...(Array.isArray(item.aliases) ? item.aliases : []),
            item.subMarket ? `${item.subMarket}${item.code}` : '',
            item.subMarket ? `${item.code}.${item.subMarket}` : '',
          ].filter(Boolean),
          source,
        });

        const stockBasicsItems = Array.isArray(stockBasicsPayload?.items)
          ? stockBasicsPayload.items.map((item, index) => mapStockBasic(item, index, 'stock.basics.suggest'))
          : [];
        const fallbackItems = Array.isArray(fallbackSearchPayload?.items)
          ? fallbackSearchPayload.items.map((item, index) => mapStockBasic(item, index, 'stock.basics.search'))
          : [];
        const indexPresetItems = STOCK_INDEX_PRESET_ITEMS.filter((item) => includesSearchKeyword(item, keyword))
          .map((item) => ({ ...item, symbolType: 'stock' }));

        const merged = mergeAndDedupeSearchItems([
          ...indexPresetItems,
          ...stockBasicsItems,
          ...fallbackItems,
        ]).filter((item) => includesSearchKeyword(item, keyword));
        setSearchSuggestions(merged.slice(0, 20));
      } catch (error) {
        if (cancelled) return;
        setSearchSuggestions([]);
        setSearchError(`检索失败：${error.message || '未知错误'}`);
      } finally {
        if (!cancelled) {
          setSearchLoading(false);
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [code, futuresPresetItems, marketType, searchFocused]);

  const queryStock = useCallback(async (stockCode, nextTimeframe) => {
    const rawInput = String(stockCode || '').trim();
    if (!rawInput) throw new Error('请输入股票代码');
    let codeText = normalizeCodeInput(rawInput);
    const looksLikeCode = /^(\d{6}|SH\d{6}|SZ\d{6}|HK\d{5}|[A-Z]{1,6}(?:\.[A-Z]{1,3})?)$/.test(codeText);
    if (!looksLikeCode) {
      const payload = await clientApi.stockBasics.suggest({ q: rawInput, limit: 10 })
        .catch(() => clientApi.stockBasics.search({ q: rawInput, limit: 10 }));
      const first = Array.isArray(payload?.items) ? payload.items[0] : null;
      const resolvedCode = normalizeCodeInput(first?.code || first?.stockCode || '');
      if (!resolvedCode) {
        throw new Error('未匹配到股票代码，请输入代码或从下拉结果选择');
      }
      codeText = resolvedCode;
    }

    const isMinute = String(nextTimeframe) === '1m';
    if (isMinute) {
      const payload = await clientApi.stockMonitor.kline({
        stockCode: codeText,
        timeframe: '1m',
        limit: 1800,
      });
      const rawCandles = Array.isArray(payload?.candles) ? payload.candles : [];
      const candles = keepLatestTradeDayCandles(rawCandles);
      const chartData = mapCandlesToChartData(candles, { timeframe: '1m' });
      if (!chartData.length) throw new Error(payload?.error || '未获取到可展示的分时K线数据');

      return {
        marketType: 'stock',
        symbol: String(payload?.quoteCode || payload?.stockCode || codeText),
        name: String(payload?.name || payload?.quote?.stockName || codeText),
        timeframe: '1m',
        timeframeLabel: String(payload?.timeframeLabel || getTimeframeLabel('stock', '1m')),
        quote: payload?.quote || null,
        candles,
        chartData,
        candleDataSource: payload?.candleDataSource || null,
        quoteDataSource: payload?.quote?.dataSource || null,
        warning: payload?.warning || null,
        error: payload?.error || null,
      };
    }

    const daysByTimeframe = {
      '1d': 360,
      '1w': 1000,
      '1M': 1800,
    };
    const days = daysByTimeframe[nextTimeframe] || 360;

    const [quote, history] = await Promise.all([
      clientApi.stocks.quote(codeText),
      clientApi.stocks.history(codeText, { days }),
    ]);

    const historyRows = Array.isArray(history?.items) ? history.items : [];
    const candles = aggregateDailyCandles(historyRows, nextTimeframe);
    const chartData = mapCandlesToChartData(candles, { timeframe: nextTimeframe });
    if (!chartData.length) throw new Error('未获取到可展示的K线数据');

    return {
      marketType: 'stock',
      symbol: codeText,
      name: String(quote?.stockName || history?.stockName || codeText),
      timeframe: nextTimeframe,
      timeframeLabel: getTimeframeLabel('stock', nextTimeframe),
      quote,
      candles,
      chartData,
      candleDataSource: 'stock.history.daily',
      quoteDataSource: quote?.dataSource || null,
      warning: nextTimeframe !== '1d' ? `${getTimeframeLabel('stock', nextTimeframe)}由日线聚合生成` : null,
      error: null,
    };
  }, []);

  const queryFutures = useCallback(async (inputCode, nextTimeframe) => {
    const codeText = String(inputCode || '').trim();
    if (!codeText) throw new Error('请输入期货代码');

    const resolved = await clientApi.futures.resolve({ code: codeText, name: codeText });
    const normalizedCode = String(resolved?.quoteCode || '').trim().toUpperCase();
    if (!normalizedCode) throw new Error('期货代码解析失败');

    const payload = await clientApi.futures.monitor({
      quoteCode: normalizedCode,
      timeframe: nextTimeframe,
      limit: resolveFuturesLimit(nextTimeframe),
    });

    const item = Array.isArray(payload?.items) ? payload.items[0] : null;
    if (!item) throw new Error('未返回期货行情数据');

    const candles = Array.isArray(item?.candles) ? item.candles : [];
    const chartData = mapCandlesToChartData(candles, { timeframe: nextTimeframe });
    if (!chartData.length) throw new Error(item?.error || '未获取到可展示的K线数据');

    return {
      marketType: 'futures',
      symbol: String(item?.quoteCode || normalizedCode),
      name: String(item?.name || resolved?.code || normalizedCode),
      timeframe: String(item?.timeframe || nextTimeframe),
      timeframeLabel: String(item?.timeframeLabel || getTimeframeLabel('futures', nextTimeframe)),
      quote: item?.quote || null,
      candles,
      chartData,
      candleDataSource: item?.candleDataSource || null,
      quoteDataSource: item?.quote?.dataSource || null,
      warning: item?.warning || null,
      error: item?.error || null,
    };
  }, []);

  const runQuery = useCallback(async ({
    codeValue = code,
    marketValue = marketType,
    timeframeValue = timeframe,
  } = {}) => {
    const normalizedCode = String(codeValue || '').trim();
    if (!normalizedCode) {
      setResultSafely(buildEmptyResult({
        marketType: marketValue,
        timeframe: timeframeValue,
        symbol: '',
        error: '请输入代码',
      }));
      return;
    }

    setLoading(true);
    try {
      let payload;
      let effectiveMarket = marketValue;
      if (marketValue === 'stock') {
        try {
          payload = await queryStock(normalizedCode, timeframeValue);
          effectiveMarket = 'stock';
        } catch (error) {
          if (looksLikeFuturesCode(normalizedCode)) {
            payload = await queryFutures(normalizedCode, timeframeValue);
            effectiveMarket = 'futures';
          } else {
            throw error;
          }
        }
      } else {
        try {
          payload = await queryFutures(normalizedCode, timeframeValue);
          effectiveMarket = 'futures';
        } catch (error) {
          if (/^\d{6}$/.test(normalizedCode) || /^SH\d{6}$/.test(normalizedCode) || /^SZ\d{6}$/.test(normalizedCode)) {
            payload = await queryStock(normalizedCode, timeframeValue);
            effectiveMarket = 'stock';
          } else {
            throw error;
          }
        }
      }

      setMarketType(effectiveMarket);
      setCode(payload.symbol);
      setTimeframe(payload.timeframe);
      setResultSafely(payload);
    } catch (error) {
      setResultSafely(buildEmptyResult({
        marketType,
        timeframe: timeframeValue,
        symbol: normalizedCode,
        error: error?.message || '未知错误',
      }));
    } finally {
      setLoading(false);
    }
  }, [code, marketType, queryFutures, queryStock, setResultSafely, timeframe]);

  useEffect(() => {
    if (!normalizedInitialCode) return;
    if (autoLoadRef.current === normalizedInitialCode) return;
    autoLoadRef.current = normalizedInitialCode;

    const nextMarketType = inferredInitialMarketType;
    const nextTimeframe = nextMarketType === 'stock' ? '1m' : (futuresTimeframes[0]?.key || '1m');
    setMarketType(nextMarketType);
    setCode(normalizedInitialCode);
    setTimeframe(nextTimeframe);
    runQuery({
      codeValue: normalizedInitialCode,
      marketValue: nextMarketType,
      timeframeValue: nextTimeframe,
    }).catch(() => {});
  }, [futuresTimeframes, inferredInitialMarketType, normalizedInitialCode, runQuery]);

  useEffect(() => {
    if (loading || isPending) return undefined;
    const currentMarket = result?.marketType || marketType;
    const currentCode = String(result?.symbol || code || '').trim();
    const currentTimeframe = String(result?.timeframe || timeframe || '').trim();
    if (!currentCode) return undefined;
    if (currentMarket !== 'stock') return undefined;
    if (currentTimeframe !== '1m') return undefined;

    const timer = window.setInterval(() => {
      runQuery({
        codeValue: currentCode,
        marketValue: 'stock',
        timeframeValue: '1m',
      }).catch(() => {});
    }, 30000);

    return () => window.clearInterval(timer);
  }, [code, isPending, loading, marketType, result?.marketType, result?.symbol, result?.timeframe, runQuery, timeframe]);

  const snapshot = useMemo(() => buildSnapshot(result), [result]);
  const metrics = useMemo(() => buildMetrics(result, snapshot), [result, snapshot]);
  const chartData = Array.isArray(result?.chartData) ? result.chartData : [];
  const activeCode = String(result?.symbol || code || '').trim();
  const activeName = String(result?.name || '').trim();
  const activeTimeframeLabel = result?.timeframeLabel || getTimeframeLabel(result?.marketType || marketType, result?.timeframe || timeframe);
  const priceColorClass = Number(snapshot?.change || 0) >= 0 ? 'text-rose-600' : 'text-emerald-600';
  const sideSummaryItems = useMemo(() => {
    if (result?.marketType === 'futures') return [];
    const quote = result?.quote || {};
    const derived = calcStockLimitPrices({
      prevClose: quote.prevClose ?? snapshot?.prevClose,
      code: result?.symbol || code,
      name: result?.name || quote?.stockName,
    });
    const amplitude = toNum(quote.amplitude);
    const derivedAmplitude = (
      Number.isFinite(toNum(snapshot?.high))
      && Number.isFinite(toNum(snapshot?.low))
      && Number.isFinite(toNum(snapshot?.prevClose))
      && Number(snapshot.prevClose) > 0
    )
      ? ((Number(snapshot.high) - Number(snapshot.low)) / Number(snapshot.prevClose)) * 100
      : null;
    return [
      { label: '涨停', value: toNum(quote.limitUp) ?? derived.limitUp, digits: 2 },
      { label: '跌停', value: toNum(quote.limitDown) ?? derived.limitDown, digits: 2 },
      { label: '振幅', value: amplitude ?? derivedAmplitude, digits: 2, suffix: '%' },
    ];
  }, [code, result, snapshot]);
  const hoverDetail = useMemo(() => {
    if (!hoveredCandle) return null;
    const rows = Array.isArray(chartData) ? chartData : [];
    if (!rows.length) return null;
    const targetTs = Number(hoveredCandle?.time);
    const targetKey = String(hoveredCandle?.time || '');
    const normalizedTargetTs = Number.isFinite(targetTs) ? targetTs : null;
    const targetIndex = rows.findIndex((item) => String(item?.time || '') === targetKey);
    const fallbackIndex = normalizedTargetTs == null
      ? -1
      : rows.findIndex((item) => Number(item?.time) === normalizedTargetTs);
    const resolvedIndex = targetIndex >= 0 ? targetIndex : fallbackIndex;
    if (resolvedIndex < 0) return null;

    const row = rows[resolvedIndex];
    const price = toNum(row?.close);
    const prevClose = toNum(snapshot?.prevClose);

    let cumulativeAmount = 0;
    let cumulativeVolume = 0;
    for (let i = 0; i <= resolvedIndex; i += 1) {
      const item = rows[i];
      const volume = Math.max(0, toNum(item?.value) ?? 0);
      const amount = toNum(item?.amount);
      if (Number.isFinite(amount) && amount > 0 && volume > 0) {
        cumulativeAmount += amount;
        cumulativeVolume += volume;
      } else {
        const close = toNum(item?.close) ?? 0;
        cumulativeAmount += close * volume;
        cumulativeVolume += volume;
      }
    }
    const avgPrice = cumulativeVolume > 0 ? (cumulativeAmount / cumulativeVolume) : price;
    const change = Number.isFinite(price) && Number.isFinite(prevClose) ? price - prevClose : null;
    const changePct = Number.isFinite(change) && Number.isFinite(prevClose) && prevClose !== 0
      ? (change / prevClose) * 100
      : null;

    return {
      timeLabel: formatHoverTimeLabel(row?.dateText || row?.time),
      latest: price,
      change,
      changePct,
      avgPrice,
      volume: toNum(row?.value),
    };
  }, [chartData, hoveredCandle, snapshot?.prevClose]);
  const hoverTooltipLayout = useMemo(() => {
    const axisSafeRight = 86;
    const edgePadding = 8;
    const gap = 12;
    const tooltipWidth = Math.max(160, Number(hoverTooltipSize?.width) || 208);
    const tooltipHeight = Math.max(80, Number(hoverTooltipSize?.height) || 142);
    if (!hoverPointer) {
      return { left: edgePadding, top: edgePadding };
    }
    const x = Number(hoverPointer?.x);
    const y = Number(hoverPointer?.y);
    const width = Number(hoverPointer?.width);
    const height = Number(hoverPointer?.height);
    if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) {
      return { left: edgePadding, top: edgePadding };
    }

    let left = x + gap;
    let top = Number.isFinite(y) ? (y + gap) : edgePadding;

    const maxLeft = width - axisSafeRight - tooltipWidth - edgePadding;
    if (left > maxLeft) {
      left = x - tooltipWidth - gap;
    }
    if (left < edgePadding) {
      left = edgePadding;
    }

    if (Number.isFinite(height) && height > 0) {
      const maxTop = height - tooltipHeight - edgePadding;
      if (top > maxTop) {
        top = y - tooltipHeight - gap;
      }
      if (top < edgePadding) {
        top = edgePadding;
      }
    }

    return { left, top };
  }, [hoverPointer, hoverTooltipSize]);
  useLayoutEffect(() => {
    if (!hoverDetail) return;
    const el = hoverTooltipRef.current;
    if (!el) return;
    const nextWidth = Number(el.offsetWidth || 0);
    const nextHeight = Number(el.offsetHeight || 0);
    if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight)) return;
    setHoverTooltipSize((prev) => {
      if (prev.width === nextWidth && prev.height === nextHeight) return prev;
      return { width: nextWidth, height: nextHeight };
    });
  }, [hoverDetail]);

  const onSubmit = useCallback(() => {
    runQuery().catch(() => {});
  }, [runQuery]);

  const selectSearchSuggestion = useCallback((item) => {
    const nextCode = String(item?.stockCode || '').trim().toUpperCase();
    if (!nextCode) return;
    const nextMarketType = item?.symbolType === 'futures' ? 'futures' : 'stock';
    const availableTimeframes = buildTimeframeOptions(nextMarketType, futuresTimeframes).map((entry) => entry.key);
    const nextTimeframe = availableTimeframes.includes(timeframe)
      ? timeframe
      : (nextMarketType === 'stock' ? '1m' : (availableTimeframes[0] || '1m'));

    setMarketType(nextMarketType);
    setCode(nextCode);
    setTimeframe(nextTimeframe);
    setSearchFocused(false);
    setSearchError('');
    setSearchSuggestions([]);

    runQuery({
      codeValue: nextCode,
      marketValue: nextMarketType,
      timeframeValue: nextTimeframe,
    }).catch(() => {});
  }, [futuresTimeframes, runQuery, timeframe]);

  const onTimeframeChange = useCallback((next) => {
    const nextTimeframe = String(next || '1d');
    setTimeframe(nextTimeframe);
    if (!code && !result?.symbol) return;
    runQuery({
      codeValue: code || result?.symbol || normalizedInitialCode,
      marketValue: result?.marketType || marketType,
      timeframeValue: nextTimeframe,
    }).catch(() => {});
  }, [code, marketType, normalizedInitialCode, result?.marketType, result?.symbol, runQuery]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <CandlestickChart className="size-5" />
            K线行情
          </CardTitle>
          <CardDescription>单品种股票/期货K线查询。</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-center gap-1">
            <div className="w-[108px] shrink-0">
              <Select value={marketType} onValueChange={(next) => {
                const target = next === 'futures' ? 'futures' : 'stock';
                setMarketType(target);
                setCode('');
                setSearchSuggestions([]);
                setSearchError('');
                setSearchLoading(false);
                setTimeframe(target === 'stock' ? '1m' : (futuresTimeframes[0]?.key || '1m'));
                setResult(buildEmptyResult({
                  marketType: target,
                  timeframe: target === 'stock' ? '1m' : (futuresTimeframes[0]?.key || '1m'),
                }));
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="分类" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stock">股票</SelectItem>
                  <SelectItem value="futures">期货</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="relative shrink-0" style={{ width: '300px', minWidth: '300px' }}>
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                onFocus={() => {
                  if (searchBlurTimerRef.current) {
                    window.clearTimeout(searchBlurTimerRef.current);
                  }
                  setSearchFocused(true);
                }}
                onBlur={() => {
                  if (searchBlurTimerRef.current) {
                    window.clearTimeout(searchBlurTimerRef.current);
                  }
                  searchBlurTimerRef.current = window.setTimeout(() => {
                    setSearchFocused(false);
                  }, 120);
                }}
                placeholder={marketType === 'stock' ? '输入名称/代码/缩写，如 贵州茅台 / 600519 / AAPL' : '输入名称/代码，如 黄金 / 101.GC00Y / au'}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onSubmit();
                  }
                }}
              />
              {(searchFocused && (searchLoading || searchError || searchSuggestions.length > 0)) ? (
                <div className="absolute left-0 top-[calc(100%+4px)] z-30 max-h-64 w-full overflow-auto rounded-md border border-border/70 bg-background shadow-lg">
                  {searchLoading ? <p className="px-3 py-2 text-xs text-muted-foreground">检索中...</p> : null}
                  {searchError ? <p className="px-3 py-2 text-xs text-red-600">{searchError}</p> : null}
                  {!searchLoading && !searchError && !searchSuggestions.length ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">未匹配到结果，可继续手动输入</p>
                  ) : null}
                  {searchSuggestions.map((item) => (
                    <button
                      key={`${item.symbolType}-${item.market}-${item.stockCode}`}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectSearchSuggestion(item)}
                      className="flex w-full items-center justify-between gap-2 border-t border-border/50 px-3 py-2 text-left hover:bg-muted/40 first:border-t-0"
                    >
                      <span className="truncate text-sm">{item.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {item.stockCode} · {item.market}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <Button type="button" className="min-w-[92px] shrink-0" onClick={onSubmit} disabled={loading || isPending}>
              {loading ? <RefreshCw className="size-4 animate-spin" /> : <Search className="size-4" />}
              查询
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-2xl font-semibold tracking-tight">{activeName || '--'}</h3>
                <Badge variant="outline">{activeCode || '--'}</Badge>
                <Badge variant="secondary">{result?.marketType === 'futures' ? '期货' : '股票'}</Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {formatTextDateTime(snapshot?.tradeTime)}
                {result?.quoteDataSource ? ` · ${result.quoteDataSource}` : ''}
                {result?.candleDataSource ? ` · ${result.candleDataSource}` : ''}
              </p>
            </div>

            <div className="ml-auto flex min-w-[560px] flex-col items-end gap-2">
              <div className="flex flex-wrap items-end gap-x-3 gap-y-1 justify-end">
                <div className={`text-5xl font-semibold tracking-tight ${priceColorClass}`}>
                  {formatNum(snapshot?.close, 2)}
                </div>
                <div className={`pb-1 text-3xl font-medium ${priceColorClass}`}>
                  {formatSigned(snapshot?.change, 2)} {formatSigned(snapshot?.changePct, 2, '%')}
                </div>
              </div>

              {sideSummaryItems.length ? (
                <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 text-sm md:text-base gap-2">
                  {sideSummaryItems.map((item) => (
                    <div key={item.label} className="inline-flex items-center gap-1 whitespace-nowrap">
                      <span className="text-muted-foreground">{item.label}:</span>
                      <span
                        className={`font-semibold ${
                          item.label === '涨停'
                            ? 'text-rose-600'
                            : item.label === '跌停'
                              ? 'text-emerald-600'
                              : 'text-foreground'
                        }`}
                      >
                        {formatMetricValue(item)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.label} className="inline-flex items-center justify-start gap-1.5 py-0.5 text-sm leading-6">
                <p className="text-muted-foreground">{metric.label}:</p>
                <p className={`font-semibold ${resolveMetricValueClass(metric, result, snapshot)}`}>{formatMetricValue(metric)}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>K线图</CardTitle>
            </div>
            <div className="text-xs text-muted-foreground">
              {result?.warning ? result.warning : result?.error ? '查询异常' : ''}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {timeframeOptions.map((item) => (
              <Button
                key={item.key}
                type="button"
                size="sm"
                variant={String(item.key) === String(timeframe) ? 'default' : 'outline'}
                onClick={() => onTimeframeChange(item.key)}
                disabled={loading || isPending}
              >
                {item.label || item.key}
              </Button>
            ))}
          </div>

          {chartData.length ? (
            <div className="relative">
              {hoverDetail ? (
                <div
                  ref={hoverTooltipRef}
                  className="pointer-events-none absolute top-2 z-10 rounded border border-slate-300 bg-white px-3 py-2 text-[11px] leading-4 shadow-sm"
                  style={{ left: hoverTooltipLayout.left, top: hoverTooltipLayout.top }}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">时间:</span>
                      <span>{hoverDetail.timeLabel}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">最新:</span>
                      <span className={Number(hoverDetail.change || 0) > 0 ? 'text-rose-600' : Number(hoverDetail.change || 0) < 0 ? 'text-emerald-600' : ''}>
                        {formatNum(hoverDetail.latest, 2)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">涨跌幅:</span>
                      <span className={Number(hoverDetail.changePct || 0) > 0 ? 'text-rose-600' : Number(hoverDetail.changePct || 0) < 0 ? 'text-emerald-600' : ''}>
                        {formatSigned(hoverDetail.changePct, 2, '%')}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">涨跌额:</span>
                      <span className={Number(hoverDetail.change || 0) > 0 ? 'text-rose-600' : Number(hoverDetail.change || 0) < 0 ? 'text-emerald-600' : ''}>
                        {formatSigned(hoverDetail.change, 2)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">均价:</span>
                      <span>{formatNum(hoverDetail.avgPrice, 2)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">成交量:</span>
                      <span>{formatCompact(hoverDetail.volume)}</span>
                    </div>
                  </div>
                </div>
              ) : null}
              <PriceVolumeChart
                data={chartData}
                timeframe={result?.timeframe || timeframe}
                mode={String(result?.timeframe || timeframe || '') === '1m' ? 'intraday-line' : 'candlestick'}
                referencePrice={snapshot?.prevClose}
                enforceSymmetricReference={String(result?.timeframe || timeframe || '') === '1m'}
                height={460}
                className="w-full"
                onHoverCandle={onHoverChartCandle}
              />
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border/80 p-10 text-center text-sm text-muted-foreground">
              暂无K线数据
            </div>
          )}

          {result?.warning ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">提示：{result.warning}</p>
          ) : null}

          {result?.error ? (
            <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">错误：{result.error}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Info, RefreshCw, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { clientApi } from '@/lib/client-api';
import { FuturesPriceCanvas, FuturesVolumeCanvas } from '@/components/charts/futures-mini-canvas';

const FUTURES_KLINE_PRESET_ITEMS = [
  { key: 'minute', label: '分钟' },
  { key: 'day', label: '日K' },
  { key: 'week', label: '周K' },
  { key: 'month', label: '月K' },
];

const FUTURES_INTRADAY_KEYS = ['1m', '5m', '15m', '30m', '60m', '30s'];
const FUTURES_LONG_KLINE_KEYS = new Set(['1d', '1w', '1M']);
const FUTURES_MONITOR_LIMIT_MAP = {
  '1m': 1800,
};
const AUTO_REFRESH_OPTIONS = [
  { value: 30000, label: '30秒' },
  { value: 60000, label: '1分钟' },
  { value: 120000, label: '2分钟' },
  { value: 300000, label: '5分钟' },
  { value: 0, label: '关闭自动刷新' },
];

function safeNum(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(digits);
}

function signedPct(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  const text = n.toFixed(digits);
  return `${n > 0 ? '+' : ''}${text}%`;
}

function signedNum(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  const text = n.toFixed(digits);
  return `${n > 0 ? '+' : ''}${text}`;
}

function compactNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  if (Math.abs(n) >= 100000000) return `${(n / 100000000).toFixed(2)}亿`;
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(2)}万`;
  return Math.round(n).toLocaleString();
}

function formatDateTime(value) {
  if (!value) return '--';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);

  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  const ss = String(dt.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function TradingHoursInfo({ value }) {
  const text = String(value || '').trim();
  if (!text) return null;
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex items-center align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        tabIndex={0}
        aria-label={`交易时段：${text}`}
        aria-expanded={open ? 'true' : 'false'}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-[#8aa0c8] transition hover:bg-[#eef4ff] hover:text-[#5775ad] focus:outline-none focus:ring-2 focus:ring-[#c7d8fb]"
      >
        <Info className="size-4" />
      </button>
      <div
        className={`absolute left-full top-1/2 z-50 ml-2 w-80 max-w-[min(20rem,calc(100vw-2rem))] -translate-y-1/2 rounded-xl border border-[#dbe4f8] bg-white px-3 py-2 text-left text-xs leading-5 whitespace-normal break-words text-[#5f7299] shadow-[0_12px_30px_rgba(66,105,168,0.16)] transition ${
          open ? 'pointer-events-auto visible opacity-100' : 'pointer-events-none invisible opacity-0'
        }`}
      >
        <span className="font-semibold text-slate-700">交易时段</span>
        <span className="mt-1 block">{text}</span>
      </div>
    </span>
  );
}

function formatFuturesDisplayName(nameOrCode = '') {
  return String(nameOrCode || '')
    .replace(/[\(（]\s*自动匹配当前合约\s*[\)）]/g, '')
    .trim();
}

function normalizeFuturesQuoteForUi(quote = {}) {
  const price = Number(quote?.price);
  const change = Number(quote?.change);
  let prevClose = Number(quote?.prevClose);
  const derivedPrevClose = Number.isFinite(price) && Number.isFinite(change) ? price - change : Number.NaN;

  const priceOk = Number.isFinite(price);
  const changeOk = Number.isFinite(change);
  if (Number.isFinite(derivedPrevClose)) {
    const inconsistent =
      Number.isFinite(prevClose) && Math.abs(prevClose - derivedPrevClose) > Math.max(Math.abs(derivedPrevClose) * 0.001, 0.01);
    if (!Number.isFinite(prevClose) || inconsistent) {
      prevClose = derivedPrevClose;
    }
  }

  let changePct = Number(quote?.changePct);
  if (changeOk && Number.isFinite(prevClose) && prevClose !== 0) {
    changePct = (change / prevClose) * 100;
  } else if (!Number.isFinite(changePct)) {
    changePct = null;
  }

  return {
    ...quote,
    price: priceOk ? price : null,
    change: changeOk ? change : null,
    prevClose: Number.isFinite(prevClose) ? prevClose : null,
    changePct: Number.isFinite(changePct) ? changePct : null,
  };
}

function inferFuturesKlinePreset(timeframe = '') {
  const key = String(timeframe || '');
  if (key === '1d') return 'day';
  if (key === '1w') return 'week';
  if (key === '1M') return 'month';
  return 'minute';
}

function resolveMinuteTimeframeKey(timeframes = [], minuteTimeframeKey = '1m') {
  const available = new Set((timeframes || []).map((item) => item.key));
  if (available.has(minuteTimeframeKey)) return minuteTimeframeKey;
  const preferred = FUTURES_INTRADAY_KEYS.find((key) => available.has(key));
  return preferred || '1m';
}

function resolveFuturesTimeframeByPreset(preset = 'minute', timeframes = [], minuteTimeframeKey = '1m') {
  const available = new Set((timeframes || []).map((item) => item.key));
  const minuteKey = resolveMinuteTimeframeKey(timeframes, minuteTimeframeKey);

  if (preset === 'day') {
    if (available.has('1d')) return '1d';
    return minuteKey;
  }
  if (preset === 'week') {
    if (available.has('1w')) return '1w';
    if (available.has('1d')) return '1d';
    return minuteKey;
  }
  if (preset === 'month') {
    if (available.has('1M')) return '1M';
    if (available.has('1w')) return '1w';
    if (available.has('1d')) return '1d';
    return minuteKey;
  }
  return minuteKey;
}

function resolveFuturesMonitorLimit(timeframe = '') {
  const key = String(timeframe || '');
  if (FUTURES_MONITOR_LIMIT_MAP[key]) return FUTURES_MONITOR_LIMIT_MAP[key];
  if (FUTURES_LONG_KLINE_KEYS.has(key)) return 100;
  return 120;
}

function groupPresetsByExchange(items = []) {
  const source = Array.isArray(items) ? items : [];
  const grouped = new Map();
  source.forEach((item) => {
    const key = String(item.exchange || '其它');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  });
  return Array.from(grouped.entries());
}

function toNumberLike(value) {
  if (Number.isFinite(value)) return Number(value);
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim();
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : Number.NaN;
  }
  return Number.NaN;
}

function hasUsableCandles(candles = [], timeframe = '') {
  if (!Array.isArray(candles) || !candles.length) return false;
  const tf = String(timeframe || '');
  let valid = 0;
  for (const item of candles) {
    const close = toNumberLike(item?.close);
    if (Number.isFinite(close)) valid += 1;
    if (FUTURES_LONG_KLINE_KEYS.has(tf) && valid >= 1) return true;
    if (valid >= 8) return true;
  }
  if (FUTURES_LONG_KLINE_KEYS.has(tf)) return valid >= 1;
  return valid >= Math.max(3, Math.floor(candles.length * 0.2));
}

function mergeIntradayCandlesByDate(prevCandles = [], nextCandles = [], timeframe = '') {
  const tf = String(timeframe || '');
  if (tf !== '1m') return nextCandles;
  if (!Array.isArray(prevCandles) || !prevCandles.length) return nextCandles;
  if (!Array.isArray(nextCandles) || !nextCandles.length) return prevCandles;

  const prevLastDate = String(prevCandles[prevCandles.length - 1]?.date || '').slice(0, 10);
  const nextLastDate = String(nextCandles[nextCandles.length - 1]?.date || '').slice(0, 10);
  const latestDay = nextLastDate || prevLastDate;
  if (!latestDay) return nextCandles;

  const merged = new Map();
  prevCandles.forEach((item) => {
    const date = String(item?.date || '');
    if (date.slice(0, 10) === latestDay) {
      merged.set(date, item);
    }
  });
  nextCandles.forEach((item) => {
    const date = String(item?.date || '');
    if (date.slice(0, 10) === latestDay) {
      merged.set(date, item);
    }
  });

  if (!merged.size) return nextCandles;
  return Array.from(merged.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, item]) => item);
}

function mergeMonitorPayload(prev, next) {
  if (!next || !Array.isArray(next.items)) return next;
  if (!prev || !Array.isArray(prev.items)) return next;

  const prevById = new Map(prev.items.map((item) => [item?.id, item]));
  const mergedItems = next.items.map((item) => {
    const prevItem = prevById.get(item?.id);
    const incomingCandles = Array.isArray(item?.candles) ? item.candles : [];
    const previousCandles = Array.isArray(prevItem?.candles) ? prevItem.candles : [];
    const incomingTimeframe = String(item?.timeframe || '');
    const previousTimeframe = String(prevItem?.timeframe || '');
    const mergedCandles = mergeIntradayCandlesByDate(previousCandles, incomingCandles, item?.timeframe || prevItem?.timeframe);
    const keepPreviousCandles = (
      incomingTimeframe
      && previousTimeframe
      && incomingTimeframe === previousTimeframe
      && !hasUsableCandles(incomingCandles, incomingTimeframe)
      && hasUsableCandles(previousCandles, previousTimeframe)
    );

    if (!keepPreviousCandles) {
      return {
        ...item,
        candles: mergedCandles,
      };
    }

    return {
      ...item,
      candles: previousCandles,
      timeframe: item?.timeframe || prevItem?.timeframe,
      timeframeLabel: item?.timeframeLabel || prevItem?.timeframeLabel,
      candleDataSource: prevItem?.candleDataSource || item?.candleDataSource || null,
      // 展示最新价格，但图表在本轮数据异常时回退到上一轮有效K线，避免整块空白。
      warning: item?.warning || 'K线数据暂不可用，已回退上一轮图形',
    };
  });

  return {
    ...next,
    items: mergedItems,
  };
}

function Modal({ open, title, onClose, children, widthClass = 'max-w-3xl' }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div
        className={`w-full ${widthClass} rounded-2xl border border-border/70 bg-background shadow-xl`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="max-h-[80vh] overflow-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function FuturesPanel() {
  const [categories, setCategories] = useState([]);
  const [timeframes, setTimeframes] = useState([]);
  const [presets, setPresets] = useState([]);
  const [monitor, setMonitor] = useState(null);
  const [timeframe, setTimeframe] = useState('30s');
  const [klinePreset, setKlinePreset] = useState('minute');
  const [minuteTimeframeKey, setMinuteTimeframeKey] = useState('1m');
  const [autoRefreshMs, setAutoRefreshMs] = useState(30000);
  const [loading, setLoading] = useState(false);
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', isError: false });
  const [, startMonitorTransition] = useTransition();

  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryEditingId, setCategoryEditingId] = useState(null);
  const [categoryName, setCategoryName] = useState('');
  const [categoryDesc, setCategoryDesc] = useState('');

  const [symbolModalOpen, setSymbolModalOpen] = useState(false);
  const [symbolCategoryId, setSymbolCategoryId] = useState('');
  const [symbolPresetCode, setSymbolPresetCode] = useState('');
  const [symbolName, setSymbolName] = useState('');
  const [symbolCode, setSymbolCode] = useState('');

  const [consoleModalOpen, setConsoleModalOpen] = useState(false);
  const monitorInFlightRef = useRef(false);
  const pendingMonitorRef = useRef(null);
  const monitorRef = useRef(null);

  const presetGroups = useMemo(() => groupPresetsByExchange(presets), [presets]);

  const groupedByCategory = useMemo(() => {
    const map = new Map();
    const items = Array.isArray(monitor?.items) ? monitor.items : [];
    items.forEach((item) => {
      if (!map.has(item.categoryId)) map.set(item.categoryId, []);
      map.get(item.categoryId).push(item);
    });
    return map;
  }, [monitor?.items]);

  const flatSymbols = useMemo(() => {
    return categories.flatMap((category) =>
      (category.symbols || []).map((symbol) => ({
        ...symbol,
        categoryName: category.name,
      })),
    );
  }, [categories]);

  const setOkMessage = useCallback((text) => setMessage({ text, isError: false }), []);
  const setErrorMessage = useCallback((text) => setMessage({ text, isError: true }), []);

  useEffect(() => {
    monitorRef.current = monitor;
  }, [monitor]);

  const syncKlineStateByTimeframe = useCallback((nextTimeframe) => {
    const preset = inferFuturesKlinePreset(nextTimeframe);
    setKlinePreset(preset);
    if (preset === 'minute') {
      setMinuteTimeframeKey(nextTimeframe);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    const payload = await clientApi.futures.categories();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    setCategories(items);
    return items;
  }, []);

  const loadTimeframes = useCallback(async () => {
    const payload = await clientApi.futures.timeframes();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    setTimeframes(items);
    return items;
  }, []);

  const loadPresets = useCallback(async () => {
    try {
      const payload = await clientApi.futures.presets();
      setPresets(Array.isArray(payload?.items) ? payload.items : []);
    } catch (error) {
      setPresets([]);
      setErrorMessage(`预设品种拉取失败，已使用手动输入：${error.message || '未知错误'}`);
    }
  }, [setErrorMessage]);

  const loadMonitor = useCallback(
    async (targetTimeframe, { silent = false } = {}) => {
      const tf = String(targetTimeframe || timeframe || '30s');
      const fullLimit = resolveFuturesMonitorLimit(tf);
      const cachedItems = Array.isArray(monitorRef.current?.items) ? monitorRef.current.items : [];
      const hasDenseIntradayCache = tf === '1m'
        && cachedItems.some((item) => Array.isArray(item?.candles) && item.candles.length >= 600);
      let effectiveLimit = fullLimit;
      if (silent && tf === '1m') {
        // 自动刷新只拉最近窗口，结合本地合并保留全天走势，避免每30秒拉全量导致主线程卡顿。
        effectiveLimit = hasDenseIntradayCache ? 120 : fullLimit;
      }

      if (monitorInFlightRef.current) {
        const prevPending = pendingMonitorRef.current;
        pendingMonitorRef.current = {
          timeframe: tf,
          // 只要有一次主动刷新请求，排队任务就按非静默执行，避免用户看不到反馈。
          silent: prevPending ? prevPending.silent && silent : silent,
        };
        return;
      }

      monitorInFlightRef.current = true;
      let currentTask = { timeframe: tf, silent, limit: effectiveLimit };
      while (currentTask) {
        if (!currentTask.silent) setMonitorLoading(true);
        try {
          const payload = await clientApi.futures.monitor({
            timeframe: currentTask.timeframe,
            limit: currentTask.limit,
          });
          startMonitorTransition(() => {
            setMonitor((prev) => mergeMonitorPayload(prev, payload));
          });
          if (!currentTask.silent) {
            setOkMessage(`监测刷新完成：成功 ${payload?.success || 0} / 失败 ${payload?.failed || 0}`);
          }
        } catch (error) {
          if (!currentTask.silent) {
            setErrorMessage(`监测刷新失败：${error.message || '未知错误'}`);
          }
        } finally {
          if (!currentTask.silent) setMonitorLoading(false);
        }

        const pending = pendingMonitorRef.current;
        pendingMonitorRef.current = null;
        if (!pending) {
          currentTask = null;
          continue;
        }

        const pendingTf = String(pending.timeframe || currentTask.timeframe || '30s');
        const pendingFullLimit = resolveFuturesMonitorLimit(pendingTf);
        const pendingCachedItems = Array.isArray(monitorRef.current?.items) ? monitorRef.current.items : [];
        const pendingHasDenseIntradayCache = pendingTf === '1m'
          && pendingCachedItems.some((item) => Array.isArray(item?.candles) && item.candles.length >= 600);
        let pendingLimit = pendingFullLimit;
        if (pending.silent && pendingTf === '1m') {
          pendingLimit = pendingHasDenseIntradayCache ? 120 : pendingFullLimit;
        }
        currentTask = {
          timeframe: pendingTf,
          silent: pending.silent,
          limit: pendingLimit,
        };
      }

      monitorInFlightRef.current = false;
    },
    [setErrorMessage, setOkMessage, timeframe],
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setLoading(true);
      try {
        const [loadedCategories, loadedTimeframes] = await Promise.all([loadCategories(), loadTimeframes()]);
        await loadPresets();
        if (cancelled) return;

        const saved = typeof window !== 'undefined' ? window.localStorage.getItem('futures.defaultTimeframe') || '30s' : '30s';
        const frameKeys = new Set((loadedTimeframes || []).map((item) => item.key));
        const initialTimeframe = frameKeys.has(saved)
          ? saved
          : frameKeys.has('30s')
            ? '30s'
            : loadedTimeframes?.[0]?.key || '30s';

        setTimeframe(initialTimeframe);
        syncKlineStateByTimeframe(initialTimeframe);
        setSymbolCategoryId(String(loadedCategories?.[0]?.id || ''));
        await loadMonitor(initialTimeframe, { silent: initialTimeframe !== '1m' });
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(`期货模块初始化失败：${error.message || '未知错误'}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [loadCategories, loadMonitor, loadPresets, loadTimeframes, setErrorMessage, syncKlineStateByTimeframe]);

  useEffect(() => {
    if (!autoRefreshMs || autoRefreshMs <= 0) return undefined;

    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadMonitor(timeframe, { silent: true }).catch(() => {});
    }, autoRefreshMs);
    return () => window.clearInterval(timer);
  }, [autoRefreshMs, loadMonitor, timeframe]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      loadMonitor(timeframe, { silent: true }).catch(() => {});
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [loadMonitor, timeframe]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== 'Escape') return;
      setCategoryModalOpen(false);
      setSymbolModalOpen(false);
      setConsoleModalOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function resetCategoryForm() {
    setCategoryEditingId(null);
    setCategoryName('');
    setCategoryDesc('');
  }

  function openCategoryCreate() {
    resetCategoryForm();
    setCategoryModalOpen(true);
  }

  function startEditCategory(categoryId) {
    const id = Number(categoryId);
    const target = categories.find((item) => item.id === id);
    if (!target) {
      setErrorMessage(`分类不存在: ${id}`);
      return;
    }
    setCategoryEditingId(id);
    setCategoryName(target.name || '');
    setCategoryDesc(target.description || '');
    setCategoryModalOpen(true);
  }

  async function submitCategory() {
    const name = String(categoryName || '').trim();
    const description = String(categoryDesc || '').trim();
    if (!name) {
      setErrorMessage('请输入分类名称');
      return;
    }

    setLoading(true);
    try {
      if (categoryEditingId) {
        await clientApi.futures.updateCategory(categoryEditingId, { name, description });
      } else {
        await clientApi.futures.createCategory({ name, description });
      }
      await Promise.all([loadCategories(), loadMonitor(timeframe, { silent: true })]);
      setOkMessage(categoryEditingId ? `分类已更新：${name}` : `分类已新增：${name}`);
      resetCategoryForm();
      setCategoryModalOpen(false);
    } catch (error) {
      setErrorMessage(`分类处理失败：${error.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  }

  async function deleteCategory(categoryId, categoryNameText = '') {
    const id = Number(categoryId);
    if (!Number.isFinite(id) || id <= 0) {
      setErrorMessage('分类ID无效，无法删除');
      return;
    }

    const target = categories.find((item) => item.id === id);
    const symbolCount = (target?.symbols || []).length;
    const confirmed = window.confirm(`确认删除分类「${categoryNameText || id}」吗？将同时删除该分类下 ${symbolCount} 个品种。`);
    if (!confirmed) return;

    setLoading(true);
    try {
      await clientApi.futures.deleteCategory(id);
      if (categoryEditingId === id) {
        resetCategoryForm();
      }
      await Promise.all([loadCategories(), loadMonitor(timeframe, { silent: true })]);
      setOkMessage(`已删除分类：${categoryNameText || id}`);
    } catch (error) {
      setErrorMessage(`分类删除失败：${error.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  }

  async function toggleCategoryEnabled(category) {
    const id = Number(category?.id);
    if (!Number.isFinite(id) || id <= 0) {
      setErrorMessage('分类ID无效，无法切换状态');
      return;
    }

    const nextEnabled = category?.isEnabled === false;
    setLoading(true);
    try {
      await clientApi.futures.updateCategory(id, { isEnabled: nextEnabled });
      await Promise.all([loadCategories(), loadMonitor(timeframe, { silent: true })]);
      setOkMessage(`分类「${category?.name || id}」已${nextEnabled ? '开启' : '关闭'}实时监测`);
    } catch (error) {
      setErrorMessage(`分类状态更新失败：${error.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  }

  function openSymbolManage() {
    setSymbolModalOpen(true);
    if (!symbolCategoryId && categories[0]?.id) {
      setSymbolCategoryId(String(categories[0].id));
    }
  }

  async function submitSymbol() {
    const categoryId = Number(symbolCategoryId || 0);
    const name = String(symbolName || '').trim();
    const quoteCode = String(symbolCode || '').trim();

    if (!Number.isFinite(categoryId) || categoryId <= 0) {
      setErrorMessage('请先选择分类');
      return;
    }
    if (!quoteCode) {
      setErrorMessage('请输入品种代码，如 101.SI00Y');
      return;
    }

    setLoading(true);
    try {
      await clientApi.futures.createSymbol({ categoryId, name, quoteCode });
      setSymbolName('');
      setSymbolCode('');
      setSymbolPresetCode('');
      await Promise.all([loadCategories(), loadMonitor(timeframe, { silent: true })]);
      setOkMessage(`已添加品种：${name || quoteCode}`);
      setSymbolModalOpen(false);
    } catch (error) {
      setErrorMessage(`品种添加失败：${error.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  }

  async function deleteSymbol(symbolId, symbolNameText = '') {
    const id = Number(symbolId);
    if (!Number.isFinite(id) || id <= 0) {
      setErrorMessage('品种ID无效，无法删除');
      return;
    }

    const confirmed = window.confirm(`确认删除品种「${symbolNameText || id}」吗？`);
    if (!confirmed) return;

    setLoading(true);
    try {
      await clientApi.futures.deleteSymbol(id);
      await Promise.all([loadCategories(), loadMonitor(timeframe, { silent: true })]);
      setOkMessage(`已删除品种：${symbolNameText || id}`);
    } catch (error) {
      setErrorMessage(`删除失败：${error.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  }

  async function refreshMonitor() {
    await loadMonitor(timeframe, { silent: false });
  }

  async function switchTimeframe(nextTimeframe) {
    const tf = String(nextTimeframe || '30s');
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('futures.defaultTimeframe', tf);
    }
    setTimeframe(tf);
    syncKlineStateByTimeframe(tf);
    await loadMonitor(tf, { silent: false });
  }

  async function switchKlinePreset(preset) {
    const nextTimeframe = resolveFuturesTimeframeByPreset(preset, timeframes, minuteTimeframeKey);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('futures.defaultTimeframe', nextTimeframe);
    }
    setTimeframe(nextTimeframe);
    syncKlineStateByTimeframe(nextTimeframe);
    await loadMonitor(nextTimeframe, { silent: false });
  }

  const summary = monitor
    ? [
        { label: '监测品种', value: String(monitor.total ?? 0) },
        { label: '成功', value: String(monitor.success ?? 0) },
        { label: '失败', value: String(monitor.failed ?? 0) },
        { label: '时间粒度', value: monitor.timeframeLabel || monitor.timeframe || '-' },
        { label: '自动刷新', value: autoRefreshMs > 0 ? `${Math.round(autoRefreshMs / 1000)}秒` : '关闭' },
        { label: '本轮刷新', value: formatDateTime(monitor.fetchedAt) },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 px-4 py-3">
        <h2 className="text-xl font-semibold tracking-tight">期货监测</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={openCategoryCreate} disabled={loading}>
            分类管理
          </Button>
          <Button variant="outline" onClick={openSymbolManage} disabled={loading}>
            品种管理
          </Button>
          <Button variant="secondary" onClick={() => setConsoleModalOpen(true)} disabled={loading}>
            监测控制台
          </Button>
        </div>
      </div>

      {message.text ? (
        <div
          className={`rounded-xl border px-4 py-2 text-xs ${
            message.isError ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-blue-200 bg-blue-50 text-blue-700'
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {loading && !monitor ? (
        <Card>
          <CardContent className="py-10 text-sm text-muted-foreground">期货模块加载中...</CardContent>
        </Card>
      ) : null}

      {!loading && (!monitor?.items || !monitor.items.length) ? (
        <Card>
          <CardContent className="py-10 text-sm text-muted-foreground">暂无监测品种，请先新增分类和品种。</CardContent>
        </Card>
      ) : null}

      {(monitor?.categories || []).map((category) => {
        const rows = groupedByCategory.get(category.id) || [];
        return (
          <Card key={category.id} className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl font-semibold">{category.name}</CardTitle>
                <span className="rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground">{rows.length} 个品种</span>
              </div>
            </CardHeader>
            <CardContent>
              {rows.length ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  {rows.map((item) => {
                    const displayName = formatFuturesDisplayName(item.name || item.code);
                    const quote = normalizeFuturesQuoteForUi(item.quote || {});
                    const pctClass = Number(quote.changePct || 0) >= 0 ? 'text-red-600' : 'text-emerald-600';
                    const pctDigits = Math.abs(Number(quote.changePct || 0)) < 1 ? 3 : 2;
                    return (
                      <article key={item.id} className="rounded-2xl border border-[#dbe4f8] bg-[#fcfdff] p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <h4 className="truncate text-lg font-semibold leading-tight text-slate-800 sm:text-xl">{displayName}</h4>
                              <TradingHoursInfo value={item.tradingHours} />
                            </div>
                            <p className="mt-0.5 text-sm leading-none text-[#5f7299] sm:text-base">{item.quoteCode || '-'}</p>
                          </div>
                          <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                            <p className="text-[11px] text-[#6f81a8] sm:text-xs">最后刷新：{formatDateTime(quote.fetchedAt || quote.tradeTime || monitor?.fetchedAt)}</p>
                            <p className={`text-base font-semibold sm:text-lg ${pctClass}`}>{signedPct(quote.changePct, pctDigits)}</p>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 rounded-xl text-[#6f81a8] hover:bg-gray-100 hover:text-[#5a6d8f]"
                              onClick={() => deleteSymbol(item.id, displayName)}
                              disabled={loading}
                              aria-label={`删除${displayName}`}
                              title="删除"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                          <div className="rounded-2xl border border-[#dbe4f8] bg-white px-4 py-3">
                            <p className="text-sm text-[#7c8db0]">最新价</p>
                            <p className={`text-base leading-tight font-semibold tabular-nums break-all ${pctClass}`}>
                              {safeNum(quote.price)}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-[#dbe4f8] bg-white px-4 py-3">
                            <p className="text-sm text-[#7c8db0]">涨跌</p>
                            <p className={`text-base leading-tight font-semibold tabular-nums break-all ${pctClass}`}>
                              {signedNum(quote.change)}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-[#dbe4f8] bg-white px-4 py-3">
                            <p className="text-sm text-[#7c8db0]">持仓量</p>
                            <p className="text-base leading-tight font-semibold tabular-nums break-all text-slate-700">
                              {compactNumber(quote.openInterest)}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-[#dbe4f8] bg-white px-4 py-3">
                            <p className="text-sm text-[#7c8db0]">成交量</p>
                            <p className="text-base leading-tight font-semibold tabular-nums break-all text-slate-700">
                              {compactNumber(quote.volume)}
                            </p>
                          </div>
                        </div>

                        {item.error ? <p className="mt-2 text-sm text-red-600">{item.error}</p> : null}
                        {item.warning ? <p className="mt-2 text-sm text-amber-600">{item.warning}</p> : null}

                        <div className="mt-4 rounded-2xl bg-white p-2">
                          <div className="mb-2 flex items-center justify-between">
                            <h5 className="text-sm font-semibold text-[#5e74a6]">价格K线（{item.timeframeLabel || item.timeframe || '-' }）</h5>
                            <div className="flex items-center gap-2 rounded-full border border-[#d3ddf6] bg-[#f3f7ff] p-1">
                              {FUTURES_KLINE_PRESET_ITEMS.map((presetItem) => (
                                <button
                                  key={presetItem.key}
                                  type="button"
                                  className={`rounded-full px-3.5 py-0.5 text-xs font-medium ${
                                    klinePreset === presetItem.key
                                      ? 'bg-white text-blue-700 ring-1 ring-blue-200'
                                      : 'text-[#677ca9] hover:bg-blue-50'
                                  }`}
                                  onClick={() => switchKlinePreset(presetItem.key)}
                                >
                                  {presetItem.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <FuturesPriceCanvas candles={item.candles || []} prevClose={quote.prevClose} timeframe={item.timeframe || timeframe} />
                        </div>

                        <div className="mt-4 rounded-2xl bg-white p-2">
                          <h5 className="mb-2 text-sm font-semibold text-[#5e74a6]">成交量</h5>
                          <FuturesVolumeCanvas candles={item.candles || []} timeframe={item.timeframe || timeframe} />
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">该分类暂无品种</p>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Modal open={categoryModalOpen} title="分类管理" onClose={() => setCategoryModalOpen(false)}>
        <p className="mb-3 text-sm text-muted-foreground">用于组织观察池，例如贵金属、工业金属、能源化工等。</p>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">分类名称</label>
            <Input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="例如：贵金属 / 工业金属" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">分类说明</label>
            <Input value={categoryDesc} onChange={(event) => setCategoryDesc(event.target.value)} placeholder="可选：策略说明" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={submitCategory} disabled={loading}>
              {categoryEditingId ? '保存修改' : '确认新增'}
            </Button>
            {categoryEditingId ? (
              <Button variant="outline" onClick={resetCategoryForm}>
                取消编辑
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-5">
          <h4 className="mb-2 text-sm font-semibold">已有分类</h4>
          <div className="overflow-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">名称</th>
                  <th className="px-3 py-2 text-left">说明</th>
                  <th className="px-3 py-2 text-left">品种数</th>
                  <th className="px-3 py-2 text-left">状态</th>
                  <th className="px-3 py-2 text-left">操作</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((item) => (
                  <tr key={item.id} className="border-t border-border/40">
                    <td className="px-3 py-2">{item.name || '-'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{item.description || '-'}</td>
                    <td className="px-3 py-2">{(item.symbols || []).length}</td>
                    <td className="px-3 py-2">
                      <label className="inline-flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={item.isEnabled !== false}
                          onChange={() => toggleCategoryEnabled(item)}
                          disabled={loading}
                          className="size-4"
                        />
                        <span className={item.isEnabled === false ? 'text-muted-foreground' : 'text-emerald-700'}>
                          {item.isEnabled === false ? '关闭' : '开启'}
                        </span>
                      </label>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" size="sm" onClick={() => startEditCategory(item.id)}>
                          编辑
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => deleteCategory(item.id, item.name || '')}>
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!categories.length ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                      暂无分类
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>

      <Modal open={symbolModalOpen} title="品种管理" onClose={() => setSymbolModalOpen(false)}>
        <p className="mb-3 text-sm text-muted-foreground">按分类添加品种，可从预设下拉自动填充；手动输入建议标准代码。</p>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">所属分类</label>
            <select
              value={symbolCategoryId}
              onChange={(event) => setSymbolCategoryId(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">请选择分类</option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm text-muted-foreground">预设品种（按交易所）</label>
            <select
              value={symbolPresetCode}
              onChange={(event) => {
                const code = event.target.value;
                setSymbolPresetCode(code);
                if (!code) return;
                let nextName = '';
                presetGroups.forEach(([, list]) => {
                  const hit = list.find((item) => item.quoteCode === code);
                  if (hit) nextName = hit.name || '';
                });
                setSymbolName(nextName);
                setSymbolCode(code);
              }}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">手动输入（不使用预设）</option>
              {presetGroups.map(([exchange, list]) => (
                <optgroup key={exchange} label={exchange}>
                  {list.map((item) => (
                    <option key={`${exchange}-${item.quoteCode}-${item.name}`} value={item.quoteCode}>
                      {item.name} ({item.quoteCode})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm text-muted-foreground">品种名称</label>
            <Input value={symbolName} onChange={(event) => setSymbolName(event.target.value)} placeholder="例如：白银主连" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">品种代码</label>
            <Input value={symbolCode} onChange={(event) => setSymbolCode(event.target.value)} placeholder="例如：101.SI00Y / LC / au2605" />
          </div>

          <Button onClick={submitSymbol} disabled={loading}>
            确认添加
          </Button>
        </div>

        <div className="mt-5">
          <h4 className="mb-2 text-sm font-semibold">已添加品种</h4>
          <div className="overflow-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">分类</th>
                  <th className="px-3 py-2 text-left">品种</th>
                  <th className="px-3 py-2 text-left">代码</th>
                  <th className="px-3 py-2 text-left">操作</th>
                </tr>
              </thead>
              <tbody>
                {flatSymbols.map((item) => (
                  <tr key={item.id} className="border-t border-border/40">
                    <td className="px-3 py-2">{item.categoryName || '-'}</td>
                    <td className="px-3 py-2">{formatFuturesDisplayName(item.name || item.code || '-')}</td>
                    <td className="px-3 py-2 text-muted-foreground">{item.quoteCode || '-'}</td>
                    <td className="px-3 py-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => deleteSymbol(item.id, formatFuturesDisplayName(item.name || item.code || ''))}
                      >
                        删除
                      </Button>
                    </td>
                  </tr>
                ))}
                {!flatSymbols.length ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                      暂无已添加品种
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>

      <Modal open={consoleModalOpen} title="监测控制台" onClose={() => setConsoleModalOpen(false)} widthClass="max-w-2xl">
        <p className="mb-3 text-sm text-muted-foreground">实时行情 + K线 + 成交量，支持时间粒度切换。</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">默认K线粒度</label>
            <select
              value={timeframe}
              onChange={(event) => switchTimeframe(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {timeframes.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
              {!timeframes.length ? <option value="30s">30秒</option> : null}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">自动刷新间隔</label>
            <select
              value={String(autoRefreshMs)}
              onChange={(event) => {
                const ms = Number(event.target.value || 30000);
                setAutoRefreshMs(ms);
                setOkMessage(`自动刷新已更新：${ms > 0 ? `${Math.round(ms / 1000)}秒` : '关闭'}`);
              }}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {AUTO_REFRESH_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3">
          <Button variant="outline" onClick={refreshMonitor} disabled={monitorLoading}>
            <RefreshCw className={`mr-1 size-4 ${monitorLoading ? 'animate-spin' : ''}`} />
            刷新监测
          </Button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {summary.map((item) => (
            <div key={item.label} className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="text-sm font-semibold">{item.value}</p>
            </div>
          ))}
          {!summary.length ? <p className="text-sm text-muted-foreground">暂无监测数据</p> : null}
        </div>
      </Modal>
    </div>
  );
}

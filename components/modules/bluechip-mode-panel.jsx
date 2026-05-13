'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, SlidersHorizontal, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { clientApi } from '@/lib/client-api';
import { PriceVolumeChart } from '@/components/charts/price-volume-chart';

const LOCAL_DEFAULTS = {
  days: 180,
  indexDropPct: 10,
  stockStartDropPct: 10,
  indexStartCandlePct: 1.5,
  stopLossPct: 5,
  takeProfitPct: 15,
  mediumBullPctMain: 4,
  longBullPctMain: 6,
  mediumBullPctGrowth: 7,
  longBullPctGrowth: 10,
  failPrevHighDays: 8,
  longHalfReferenceMode: 'first_long_bull_after_start_buy',
};

const LONG_HALF_REFERENCE_OPTIONS = [
  { value: 'recent_long_bull', label: '最近长阳半体' },
  { value: 'first_long_bull_after_start_buy', label: '起涨后首根长阳半体' },
];

const PARAM_GROUPS = [
  {
    key: 'range',
    title: '数据范围',
    description: '控制分析使用的历史样本窗口。',
    cols: 'md:grid-cols-2 lg:grid-cols-3',
    fields: [
      { key: 'days', label: '日线周期(天)' },
    ],
  },
  {
    key: 'index',
    title: '指数起涨触发',
    description: '用于识别“指数起涨买点”的触发条件。',
    cols: 'md:grid-cols-2 lg:grid-cols-3',
    fields: [
      { key: 'indexDropPct', label: '指数阶段跌幅(%)' },
      { key: 'indexStartCandlePct', label: '指数中阳阈值(%)' },
    ],
  },
  {
    key: 'stock-start',
    title: '个股独立起涨触发',
    description: '用于识别“个股独立起涨买点”的触发条件。',
    cols: 'md:grid-cols-2 lg:grid-cols-3',
    fields: [
      { key: 'stockStartDropPct', label: '个股阶段跌幅(%)' },
    ],
  },
  {
    key: 'bull',
    title: '阳线分级阈值',
    description: '根据主板(10%)和创业/科创(20%)分别定义中阳、长阳。',
    cols: 'md:grid-cols-2 lg:grid-cols-4',
    fields: [
      { key: 'mediumBullPctMain', label: '主板中阳阈值(%)' },
      { key: 'longBullPctMain', label: '主板长阳阈值(%)' },
      { key: 'mediumBullPctGrowth', label: '创科中阳阈值(%)' },
      { key: 'longBullPctGrowth', label: '创科长阳阈值(%)' },
    ],
  },
  {
    key: 'sell',
    title: '卖点与风控',
    description: '止盈止损与“不过前高”离场纪律。',
    cols: 'md:grid-cols-2 lg:grid-cols-4',
    fields: [
      { key: 'stopLossPct', label: '止损(%)' },
      { key: 'takeProfitPct', label: '止盈(%)' },
      { key: 'failPrevHighDays', label: '不过前高容忍天数' },
      { key: 'longHalfReferenceMode', label: '长阳半体参考', type: 'select' },
    ],
  },
];

const SIGNAL_LABEL = {
  index_linked_start_buy: '指数联动起涨买点',
  stock_independent_start_buy: '个股独立起涨买点',
  stop_loss: '止损卖点',
  take_profit: '止盈卖点',
  break_medium: '跌破中阳',
  lose_long_half: '跌破长阳半体',
  fail_prev_high: '不过前高',
};

const INDEX_OPTIONS = [
  { value: 'AVG_CN', label: '平均股价' },
  { value: 'SH000001', label: '上证指数' },
  { value: 'SZ399001', label: '深证成指' },
  { value: 'SH000300', label: '沪深300' },
];

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeParams(input = {}) {
  const next = {};
  Object.keys(LOCAL_DEFAULTS).forEach((key) => {
    if (key === 'longHalfReferenceMode') {
      const value = String(input[key] || LOCAL_DEFAULTS[key]).trim();
      next[key] = value === 'first_long_bull_after_start_buy'
        ? 'first_long_bull_after_start_buy'
        : 'recent_long_bull';
      return;
    }
    next[key] = toNumber(input[key], LOCAL_DEFAULTS[key]);
  });
  return next;
}

function formatNum(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(digits);
}

function formatPct(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

function getCompareToneStyle(value, base) {
  const current = Number(value);
  const reference = Number(base);
  if (!Number.isFinite(current) || !Number.isFinite(reference)) return undefined;
  if (current > reference) return { color: '#dc2626' };
  if (current < reference) return { color: '#16a34a' };
  return undefined;
}

function getSignedToneStyle(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  if (n > 0) return { color: '#dc2626' };
  if (n < 0) return { color: '#16a34a' };
  return undefined;
}

function getProfitToneStyle(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return n > 0 ? { color: '#dc2626' } : { color: '#16a34a' };
}

function extractStockCode(input = '') {
  const text = String(input || '').trim().toUpperCase();
  if (!text) return '';
  const token = text.split(/[\s,，;；/|]+/).find(Boolean) || '';
  const clean = token.replace(/[^A-Z0-9.\-]/g, '');
  if (!clean) return '';

  if (/^\d{6}$/.test(clean)) return clean;
  if (/^(SH|SZ)\d{6}$/.test(clean)) return clean;
  if (/^\d{6}\.(SH|SZ)$/.test(clean)) return clean;
  if (/^(SH|SZ)\.?\d{6}$/.test(clean)) return clean;
  if (/^\d{5}$/.test(clean)) return clean;
  if (/^HK\d{5}$/.test(clean)) return clean;
  if (/^\d{5}\.HK$/.test(clean)) return clean;
  if (/^[A-Z][A-Z0-9.\-^]{0,9}$/.test(clean)) return clean;
  return '';
}

function buildCandleRows(candles = []) {
  const rows = Array.isArray(candles) ? candles : [];
  return rows.map((item, idx) => {
    const prevClose = idx > 0 ? Number(rows[idx - 1]?.close) : null;
    const open = Number(item?.open);
    const close = Number(item?.close);
    const high = Number(item?.high);
    const low = Number(item?.low);
    const changePct = Number.isFinite(prevClose) && prevClose !== 0
      ? ((close - prevClose) / prevClose) * 100
      : null;
    const bodyPct = Number.isFinite(prevClose) && prevClose !== 0
      ? ((close - open) / prevClose) * 100
      : null;
    return {
      ...item,
      date: String(item?.date || item?.time || ''),
      open,
      close,
      high,
      low,
      prevClose,
      changePct,
      bodyPct,
    };
  });
}

function findNearestBullish(rows, index, threshold) {
  if (!Array.isArray(rows) || rows.length === 0 || index < 0) return null;
  const isHit = (row) => (
    row
    && Number(row.close) > Number(row.open)
    && Number.isFinite(Number(row.bodyPct))
    && Number(row.bodyPct) >= Number(threshold || 0)
  );

  for (let i = index - 1; i >= 0; i -= 1) {
    if (isHit(rows[i])) {
      return {
        ...rows[i],
        distance: index - i,
        side: 'before',
      };
    }
  }
  for (let i = index + 1; i < rows.length; i += 1) {
    if (isHit(rows[i])) {
      return {
        ...rows[i],
        distance: i - index,
        side: 'after',
      };
    }
  }
  return null;
}

function buildIndicatorAnalysis(candles = [], targetDate = '', thresholds = {}, options = {}) {
  const rows = buildCandleRows(candles);
  const index = rows.findIndex((row) => row.date === targetDate);
  if (index < 0) return null;

  const longHalfReferenceMode = String(options?.longHalfReferenceMode || 'recent_long_bull').trim();
  const longBullPct = Number(thresholds?.longBullPct || 0);
  const startBuyDates = Array.isArray(options?.startBuyDates) ? options.startBuyDates : [];
  const target = rows[index];
  const nearestMedium = findNearestBullish(rows, index, thresholds?.mediumBullPct);
  const nearestLong = findNearestBullish(rows, index, thresholds?.longBullPct);
  const isLongBull = (row) => (
    row
    && Number(row.close) > Number(row.open)
    && Number.isFinite(Number(row.bodyPct))
    && Number(row.bodyPct) >= longBullPct
  );
  let longHalfReference = null;
  if (longHalfReferenceMode === 'first_long_bull_after_start_buy') {
    const anchorStartDate = startBuyDates
      .filter((date) => String(date || '').trim() && String(date) <= targetDate)
      .sort()
      .at(-1) || '';
    const startIndex = anchorStartDate ? rows.findIndex((row) => row.date === anchorStartDate) : -1;
    if (startIndex >= 0) {
      const hit = rows.slice(startIndex + 1, index + 1).find(isLongBull);
      if (hit) {
        longHalfReference = {
          mode: 'first_long_bull_after_start_buy',
          date: hit.date,
          halfPrice: (Number(hit.open) + Number(hit.close)) / 2,
        };
      }
    }
  } else {
    const hit = rows
      .slice(0, index + 1)
      .reverse()
      .find(isLongBull);
    if (hit) {
      longHalfReference = {
        mode: 'recent_long_bull',
        date: hit.date,
        halfPrice: (Number(hit.open) + Number(hit.close)) / 2,
      };
    }
  }

  return {
    basic: target,
    nearestMedium,
    nearestLong,
    longHalfReference,
  };
}

export function BluechipModePanel() {
  const contextMenuRef = useRef(null);
  const selectedCandleRef = useRef(null);
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [keyword, setKeyword] = useState('600519');
  const [stockCode, setStockCode] = useState('600519');
  const [stockName, setStockName] = useState('');
  const [indexCode, setIndexCode] = useState('AVG_CN');
  const [params, setParams] = useState(LOCAL_DEFAULTS);
  const [suggestions, setSuggestions] = useState([]);
  const [suggesting, setSuggesting] = useState(false);
  const [openSuggest, setOpenSuggest] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState(null);
  const [paramPanelOpen, setParamPanelOpen] = useState(false);
  const [hoveredCandle, setHoveredCandle] = useState(null);
  const [selectedCandle, setSelectedCandle] = useState(null);
  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    candleDate: '',
  });
  const [indicatorAnalysis, setIndicatorAnalysis] = useState(null);

  useEffect(() => {
    selectedCandleRef.current = selectedCandle;
  }, [selectedCandle]);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    clientApi.strategy.bluechipDefaults()
      .then((payload) => {
        if (cancelled) return;
        setParams((prev) => ({ ...prev, ...normalizeParams(payload?.defaults || {}) }));
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const q = String(keyword || '').trim();
    if (!q) {
      setSuggestions([]);
      setOpenSuggest(false);
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      setSuggesting(true);
      try {
        const payload = await clientApi.stockBasics.suggest({ q, limit: 10 });
        const rows = Array.isArray(payload?.items) ? payload.items : [];
        setSuggestions(rows);
      } catch {
        setSuggestions([]);
        setOpenSuggest(false);
      } finally {
        setSuggesting(false);
      }
    }, 220);

    return () => window.clearTimeout(timer);
  }, [keyword]);

  const signalRows = useMemo(
    () => (Array.isArray(result?.analysis?.signals) ? result.analysis.signals : []),
    [result],
  );
  const startBuyDates = useMemo(
    () => signalRows
      .filter((item) => item?.side === 'buy' && (item?.type === 'index_linked_start_buy' || item?.type === 'stock_independent_start_buy'))
      .map((item) => String(item.date || '').trim())
      .filter(Boolean),
    [signalRows],
  );

  const chartCandles = useMemo(
    () => (Array.isArray(result?.analysis?.stockCandles) ? result.analysis.stockCandles : []),
    [result],
  );
  const displayCandle = selectedCandle || hoveredCandle || null;
  const hasDisplayCandle = Boolean(displayCandle);

  const handleSelectCandle = useCallback((candle) => {
    const nextDate = String(candle?.date || candle?.time || '').trim();
    const currentDate = String(selectedCandleRef.current?.date || selectedCandleRef.current?.time || '').trim();
    if (!nextDate) return;
    if (nextDate && currentDate && nextDate === currentDate) {
      setSelectedCandle(null);
      setHoveredCandle(null);
      setContextMenu({ visible: false, x: 0, y: 0, candleDate: '' });
      return;
    }
    setSelectedCandle(candle);
    setContextMenu({ visible: false, x: 0, y: 0, candleDate: nextDate });
  }, []);

  const runAnalysis = async (preferredCode = '') => {
    const safePreferredCode = typeof preferredCode === 'string' ? preferredCode : '';
    const localCode = extractStockCode(safePreferredCode) || extractStockCode(stockCode) || extractStockCode(keyword);
    if (!localCode && !String(keyword || '').trim()) {
      setMessage('请输入股票代码或名称后再分析');
      return;
    }

    setLoading(true);
    setMessage('');
    try {
      let finalCode = localCode;
      if (!finalCode) {
        const suggestPayload = await clientApi.stockBasics.suggest({
          q: String(keyword || '').trim(),
          limit: 1,
        });
        const first = Array.isArray(suggestPayload?.items) ? suggestPayload.items[0] : null;
        finalCode = String(first?.code || '').trim();
        if (first?.name) setStockName(String(first.name));
      }
      if (!finalCode) {
        throw new Error('未识别到有效股票代码，请从下拉建议中选择后重试');
      }

      const payload = await clientApi.strategy.bluechipAnalyze({
        stockCode: finalCode,
        indexCode: String(indexCode || 'AVG_CN').trim() || 'AVG_CN',
        days: toNumber(params.days, LOCAL_DEFAULTS.days),
        params: normalizeParams(params),
      });
      setStockCode(finalCode);
      setKeyword((prev) => {
        if (String(prev || '').trim()) return prev;
        return finalCode;
      });
      setResult(payload);
      setIndicatorAnalysis(null);
      setHoveredCandle(null);
      setSelectedCandle(null);
      setContextMenu({ visible: false, x: 0, y: 0, candleDate: '' });
      const count = Array.isArray(payload?.analysis?.signals) ? payload.analysis.signals.length : 0;
      setMessage(`分析完成：${payload?.stock?.code || finalCode} ${payload?.stock?.name || ''}，识别信号 ${count} 个`);
    } catch (error) {
      setMessage(`分析失败：${error.message || '未知错误'}`);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const code = String(searchParams?.get('code') || '').trim();
    if (!code) return;
    const normalized = extractStockCode(code);
    if (!normalized) return;
    setKeyword(normalized);
    setStockCode(normalized);
    setStockName('');
    setOpenSuggest(false);
    window.setTimeout(() => {
      runAnalysis(normalized);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const summary = result?.analysis?.summary || null;
  const boardType = result?.analysis?.boardProfile?.boardType || '--';
  const thresholds = result?.analysis?.thresholds || null;

  const handleChartContextMenu = useCallback((event) => {
    event.preventDefault();
    const candle = selectedCandle || hoveredCandle;
    const date = String(candle?.date || candle?.time || '').trim();
    if (!date) {
      setContextMenu({ visible: false, x: 0, y: 0, candleDate: '' });
      return;
    }
    setSelectedCandle(candle);
    setContextMenu({
      visible: true,
      x: event.clientX,
      y: event.clientY,
      candleDate: date,
    });
  }, [hoveredCandle, selectedCandle]);

  const runIndicatorAnalysis = useCallback(() => {
    const targetDate = contextMenu.candleDate || String(selectedCandle?.date || selectedCandle?.time || '').trim();
    if (!targetDate) return;
    const next = buildIndicatorAnalysis(chartCandles, targetDate, thresholds || {}, {
      longHalfReferenceMode: params.longHalfReferenceMode,
      startBuyDates,
    });
    setIndicatorAnalysis(next);
    setContextMenu({ visible: false, x: 0, y: 0, candleDate: '' });
  }, [chartCandles, contextMenu.candleDate, params.longHalfReferenceMode, selectedCandle, startBuyDates, thresholds]);

  useEffect(() => {
    if (!contextMenu.visible) return undefined;
    const handlePointerDown = (event) => {
      const menuEl = contextMenuRef.current;
      if (menuEl && menuEl.contains(event.target)) return;
      setContextMenu((prev) => ({ ...prev, visible: false }));
    };
    const handleScroll = () => setContextMenu((prev) => ({ ...prev, visible: false }));
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [contextMenu.visible]);

  useEffect(() => {
    if (!indicatorAnalysis?.basic?.date) return;
    const next = buildIndicatorAnalysis(
      chartCandles,
      String(indicatorAnalysis.basic.date || '').trim(),
      thresholds || {},
      {
        longHalfReferenceMode: params.longHalfReferenceMode,
        startBuyDates,
      },
    );
    setIndicatorAnalysis(next);
  }, [chartCandles, indicatorAnalysis?.basic?.date, params.longHalfReferenceMode, startBuyDates, thresholds]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>蓝筹模式策略分析</CardTitle>
          <CardDescription>搜索股票后，基于指数联动起涨买点、个股独立起涨买点与卖点规则进行日线信号标注。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="relative">
              <label className="mb-1 block text-xs text-muted-foreground">股票（名称/代码）</label>
              <div className="relative">
                <Input
                  value={keyword}
                  className="pr-10"
                  onChange={(event) => {
                    const text = event.target.value;
                    setKeyword(text);
                    setStockCode(extractStockCode(text));
                    setOpenSuggest(true);
                  }}
                  onFocus={() => setOpenSuggest(true)}
                  placeholder="例如：600519 / 贵州茅台"
                />
                {String(keyword || '').trim() ? (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => {
                      setKeyword('');
                      setStockCode('');
                      setStockName('');
                      setSuggestions([]);
                      setOpenSuggest(false);
                    }}
                    aria-label="清除股票输入"
                    title="清除"
                  >
                    <X className="size-4" />
                  </button>
                ) : null}
              </div>
              {openSuggest ? (
                <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-background shadow-lg">
                  {suggesting ? <div className="px-3 py-2 text-xs text-muted-foreground">搜索中...</div> : null}
                  {!suggesting && suggestions.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">无匹配结果，可直接按代码分析</div>
                  ) : null}
                  {suggestions.map((item) => (
                    <button
                      key={`${item.market}-${item.code}`}
                      type="button"
                      className="block w-full border-b border-border/60 px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        setKeyword(`${item.code} ${item.name}`);
                        setStockCode(item.code);
                        setStockName(item.name || '');
                        setOpenSuggest(false);
                      }}
                    >
                      <div className="font-medium">{item.code} {item.name}</div>
                      <div className="text-xs text-muted-foreground">{item.market}{item.subMarket ? `/${item.subMarket}` : ''}</div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">指数代码</label>
              <Select value={indexCode} onValueChange={setIndexCode}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择指数" />
                </SelectTrigger>
                <SelectContent>
                  {INDEX_OPTIONS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-transparent select-none" aria-hidden="true">操作</label>
              <Button onClick={() => runAnalysis()} disabled={loading} className="w-full">
                {loading ? '分析中...' : '执行分析'}
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-card/60">
            <button
              type="button"
              className="flex w-full items-center justify-between px-4 py-3 text-left"
              onClick={() => setParamPanelOpen((prev) => !prev)}
            >
              <span className="inline-flex items-center gap-2 text-sm font-semibold">
                <SlidersHorizontal className="size-4" />
                参数设置
              </span>
              <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                {PARAM_GROUPS.reduce((sum, group) => sum + group.fields.length, 0)} 项
                {paramPanelOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </span>
            </button>
            {paramPanelOpen ? (
              <div className="space-y-3 border-t border-border/60 px-3 py-3">
                {PARAM_GROUPS.map((group) => (
                  <section key={group.key} className="rounded-xl border border-border/70 bg-muted/30 px-3 py-3">
                    <div className="mb-2">
                      <p className="text-sm font-semibold">{group.title}</p>
                      <p className="text-xs text-muted-foreground">{group.description}</p>
                    </div>
                    <div className={`grid gap-3 ${group.cols}`}>
                      {group.fields.map((field) => (
                        <div key={field.key}>
                          <label className="mb-1 block text-xs text-muted-foreground">{field.label}</label>
                          {field.type === 'select' && field.key === 'longHalfReferenceMode' ? (
                            <Select
                              value={String(params.longHalfReferenceMode || LOCAL_DEFAULTS.longHalfReferenceMode)}
                              onValueChange={(value) => {
                                setParams((prev) => ({ ...prev, longHalfReferenceMode: value }));
                              }}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="选择算法" />
                              </SelectTrigger>
                              <SelectContent>
                                {LONG_HALF_REFERENCE_OPTIONS.map((item) => (
                                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              type="number"
                              value={params[field.key]}
                              onChange={(event) => {
                                const value = event.target.value;
                                setParams((prev) => ({
                                  ...prev,
                                  [field.key]: value === '' ? '' : Number(value),
                                }));
                              }}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : null}
          </div>

          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
          {(stockName || result?.stock?.name) ? (
            <p className="text-xs text-muted-foreground">当前标的：{result?.stock?.code || stockCode} {result?.stock?.name || stockName}</p>
          ) : null}
        </CardContent>
      </Card>

      {result ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>策略摘要</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                <div className="min-w-[170px] flex-1 rounded-lg border border-border/70 px-3 py-2">
                  <div className="text-xs text-muted-foreground">板块类型</div>
                  <div className="text-sm font-semibold">{boardType === 'growth' ? '创业/科创(20%)' : '主板(10%)'}</div>
                </div>
                <div className="min-w-[150px] flex-1 rounded-lg border border-border/70 px-3 py-2">
                  <div className="text-xs text-muted-foreground">交易笔数</div>
                  <div className="text-sm font-semibold">{summary?.trades ?? 0}</div>
                </div>
                <div className="min-w-[150px] flex-1 rounded-lg border border-border/70 px-3 py-2">
                  <div className="text-xs text-muted-foreground">胜率</div>
                  <div className="text-sm font-semibold">{formatNum(summary?.winRatePct, 2)}%</div>
                </div>
                <div className="min-w-[150px] flex-1 rounded-lg border border-border/70 px-3 py-2">
                  <div className="text-xs text-muted-foreground">平均收益</div>
                  <div className="text-sm font-semibold" style={getProfitToneStyle(summary?.avgReturnPct)}>
                    {formatPct(summary?.avgReturnPct, 2)}
                  </div>
                </div>
                <div className="min-w-[150px] flex-1 rounded-lg border border-border/70 px-3 py-2">
                  <div className="text-xs text-muted-foreground">总收益</div>
                  <div className="text-sm font-semibold" style={getProfitToneStyle(summary?.totalReturnPct)}>
                    {formatPct(summary?.totalReturnPct, 2)}
                  </div>
                </div>
              </div>
              {thresholds ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  当前阳线阈值：中阳 {formatNum(thresholds.mediumBullPct, 2)}% / 长阳 {formatNum(thresholds.longBullPct, 2)}%
                </p>
              ) : null}
              {summary?.openPosition ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  当前持仓：{summary.openPosition.entryDate} 买入，浮动收益 {formatPct(summary.openPosition.floatingPnlPct, 2)}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>K线买卖点标记</CardTitle>
              <CardDescription>绿色上箭头为买点，红色下箭头为卖点。鼠标悬停日线时，上方会同步显示价格信息；右键可打开“指标分析”。</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <div className="text-sm font-semibold">
                      {selectedCandle ? '已选中K线价格信息' : '悬停价格信息'}
                    </div>
                    <div className="text-xs text-muted-foreground">把鼠标移动到某根日线上，这里会显示该日的基础价格信息。</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedCandle ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedCandle(null);
                          setContextMenu({ visible: false, x: 0, y: 0, candleDate: '' });
                        }}
                      >
                        取消选中
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      disabled={!hasDisplayCandle}
                      onClick={() => {
                        if (!displayCandle) return;
                        setSelectedCandle(displayCandle);
                        setContextMenu((prev) => ({
                          ...prev,
                          visible: false,
                          candleDate: String(displayCandle?.date || displayCandle?.time || '').trim(),
                        }));
                          setIndicatorAnalysis(
                            buildIndicatorAnalysis(
                              chartCandles,
                              String(displayCandle?.date || displayCandle?.time || '').trim(),
                              thresholds || {},
                              {
                                longHalfReferenceMode: params.longHalfReferenceMode,
                                startBuyDates,
                              },
                            ),
                          );
                        }}
                      >
                      指标分析
                    </Button>
                  </div>
                </div>
                <div className="grid gap-2 text-sm md:grid-cols-4 lg:grid-cols-5">
                  <div><span className="text-muted-foreground">日期：</span>{hasDisplayCandle ? (displayCandle.date || displayCandle.time || '-') : '-'}</div>
                  <div><span className="text-muted-foreground">昨收：</span>{hasDisplayCandle ? formatNum(displayCandle.prevClose, 2) : '-'}</div>
                  <div>
                    <span className="text-muted-foreground">今开：</span>
                    <span style={hasDisplayCandle ? getCompareToneStyle(displayCandle.open, displayCandle.prevClose) : undefined}>
                      {hasDisplayCandle ? formatNum(displayCandle.open, 2) : '-'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">今收：</span>
                    <span style={hasDisplayCandle ? getCompareToneStyle(displayCandle.close, displayCandle.prevClose) : undefined}>
                      {hasDisplayCandle ? formatNum(displayCandle.close, 2) : '-'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">最高：</span>
                    <span style={hasDisplayCandle ? getCompareToneStyle(displayCandle.high, displayCandle.prevClose) : undefined}>
                      {hasDisplayCandle ? formatNum(displayCandle.high, 2) : '-'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">最低：</span>
                    <span style={hasDisplayCandle ? getCompareToneStyle(displayCandle.low, displayCandle.prevClose) : undefined}>
                      {hasDisplayCandle ? formatNum(displayCandle.low, 2) : '-'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">涨幅：</span>
                    <span style={hasDisplayCandle ? getSignedToneStyle(displayCandle.changePct) : undefined}>
                      {hasDisplayCandle ? formatPct(displayCandle.changePct, 2) : '-'}
                    </span>
                  </div>
                  <div><span className="text-muted-foreground">振幅：</span>{hasDisplayCandle ? formatPct(displayCandle.amplitudePct, 2) : '-'}</div>
                  <div>
                    <span className="text-muted-foreground">实体涨跌幅：</span>
                    <span style={hasDisplayCandle ? getSignedToneStyle(displayCandle.bodyPct) : undefined}>
                      {hasDisplayCandle ? formatPct(displayCandle.bodyPct, 2) : '-'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">实体中位价：</span>
                    <span style={hasDisplayCandle ? getCompareToneStyle(displayCandle.bodyMidPrice, displayCandle.prevClose) : undefined}>
                      {hasDisplayCandle ? formatNum(displayCandle.bodyMidPrice, 2) : '-'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
                <span>
                  当前标的：{result?.stock?.name || stockName || '--'}（{result?.stock?.code || stockCode || '--'}）
                </span>
                {(hoveredCandle?.date || hoveredCandle?.time) ? (
                  <span>日期：{hoveredCandle?.date || hoveredCandle?.time}</span>
                ) : null}
              </div>
              <div
                className="relative"
                onContextMenu={handleChartContextMenu}
              >
                <PriceVolumeChart
                  data={chartCandles}
                  markers={result.analysis?.markers || []}
                  height={420}
                  className="w-full"
                  onHoverCandle={setHoveredCandle}
                  onSelectCandle={handleSelectCandle}
                  lockedCandle={selectedCandle}
                />
              </div>
              {mounted && contextMenu.visible ? createPortal(
                (
                  <div
                    ref={contextMenuRef}
                    className="fixed min-w-28 rounded-md border border-border bg-background p-1 shadow-lg"
                    style={{ left: contextMenu.x, top: contextMenu.y, zIndex: 2147483647 }}
                    onContextMenu={(event) => event.preventDefault()}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  >
                    <button
                      type="button"
                      className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        runIndicatorAnalysis();
                      }}
                    >
                      指标分析
                    </button>
                  </div>
                ),
                document.body,
              ) : null}
            </CardContent>
          </Card>

          {indicatorAnalysis ? (
            <Card>
              <CardHeader>
                <CardTitle>指标分析</CardTitle>
                <CardDescription>基于选中日线计算基础指标，并定位最近中阳/长阳。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-lg border border-border/70 px-3 py-2">
                    <div className="text-xs text-muted-foreground">日期</div>
                    <div className="text-sm font-semibold">{indicatorAnalysis.basic?.date || '--'}</div>
                  </div>
                  <div className="rounded-lg border border-border/70 px-3 py-2">
                    <div className="text-xs text-muted-foreground">昨收</div>
                    <div className="text-sm font-semibold">{formatNum(indicatorAnalysis.basic?.prevClose, 2)}</div>
                  </div>
                  <div className="rounded-lg border border-border/70 px-3 py-2">
                    <div className="text-xs text-muted-foreground">开盘/收盘</div>
                    <div className="text-sm font-semibold">
                      {formatNum(indicatorAnalysis.basic?.open, 2)} / {formatNum(indicatorAnalysis.basic?.close, 2)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/70 px-3 py-2">
                    <div className="text-xs text-muted-foreground">最低/最高</div>
                    <div className="text-sm font-semibold">
                      {formatNum(indicatorAnalysis.basic?.low, 2)} / {formatNum(indicatorAnalysis.basic?.high, 2)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/70 px-3 py-2">
                    <div className="text-xs text-muted-foreground">涨幅</div>
                    <div className="text-sm font-semibold">{formatPct(indicatorAnalysis.basic?.changePct, 2)}</div>
                  </div>
                  <div className="rounded-lg border border-border/70 px-3 py-2">
                    <div className="text-xs text-muted-foreground">K线实体幅度</div>
                    <div className="text-sm font-semibold">{formatPct(indicatorAnalysis.basic?.bodyPct, 2)}</div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-border/70 px-3 py-3">
                    <div className="mb-2 text-sm font-semibold">长阳半体参考</div>
                    {indicatorAnalysis.longHalfReference ? (
                      <div className="space-y-1 text-sm">
                        <div>算法：{indicatorAnalysis.longHalfReference.mode === 'first_long_bull_after_start_buy' ? '起涨后首根长阳半体' : '最近长阳半体'}</div>
                        <div>日期：{indicatorAnalysis.longHalfReference.date}</div>
                        <div>半体价：{formatNum(indicatorAnalysis.longHalfReference.halfPrice, 2)}</div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">未找到符合阈值的长阳参考K线。</div>
                    )}
                  </div>

                  <div className="rounded-lg border border-border/70 px-3 py-3">
                    <div className="mb-2 text-sm font-semibold">最近中阳</div>
                    {indicatorAnalysis.nearestMedium ? (
                      <div className="space-y-1 text-sm">
                        <div>日期：{indicatorAnalysis.nearestMedium.date}</div>
                        <div>开收：{formatNum(indicatorAnalysis.nearestMedium.open, 2)} / {formatNum(indicatorAnalysis.nearestMedium.close, 2)}</div>
                        <div>高低：{formatNum(indicatorAnalysis.nearestMedium.high, 2)} / {formatNum(indicatorAnalysis.nearestMedium.low, 2)}</div>
                        <div>涨幅：{formatPct(indicatorAnalysis.nearestMedium.changePct, 2)}</div>
                        <div>实体幅度：{formatPct(indicatorAnalysis.nearestMedium.bodyPct, 2)}</div>
                        <div className="text-xs text-muted-foreground">
                          位置：{indicatorAnalysis.nearestMedium.side === 'before' ? '之前' : '之后'} {indicatorAnalysis.nearestMedium.distance} 根K线
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">未找到符合阈值的中阳。</div>
                    )}
                  </div>

                  <div className="rounded-lg border border-border/70 px-3 py-3">
                    <div className="mb-2 text-sm font-semibold">最近长阳</div>
                    {indicatorAnalysis.nearestLong ? (
                      <div className="space-y-1 text-sm">
                        <div>日期：{indicatorAnalysis.nearestLong.date}</div>
                        <div>开收：{formatNum(indicatorAnalysis.nearestLong.open, 2)} / {formatNum(indicatorAnalysis.nearestLong.close, 2)}</div>
                        <div>高低：{formatNum(indicatorAnalysis.nearestLong.high, 2)} / {formatNum(indicatorAnalysis.nearestLong.low, 2)}</div>
                        <div>涨幅：{formatPct(indicatorAnalysis.nearestLong.changePct, 2)}</div>
                        <div>实体幅度：{formatPct(indicatorAnalysis.nearestLong.bodyPct, 2)}</div>
                        <div className="text-xs text-muted-foreground">
                          位置：{indicatorAnalysis.nearestLong.side === 'before' ? '之前' : '之后'} {indicatorAnalysis.nearestLong.distance} 根K线
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">未找到符合阈值的长阳。</div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>信号明细</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[460px] overflow-auto rounded-lg border border-border/70">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">日期</th>
                      <th className="px-3 py-2 text-left">方向</th>
                      <th className="px-3 py-2 text-left">类型</th>
                      <th className="px-3 py-2 text-right">价格</th>
                      <th className="px-3 py-2 text-right">收益</th>
                      <th className="px-3 py-2 text-left">原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {signalRows.length === 0 ? (
                      <tr>
                        <td className="px-3 py-4 text-center text-muted-foreground" colSpan={6}>暂无信号</td>
                      </tr>
                    ) : null}
                    {signalRows.map((item, idx) => (
                      <tr key={`${item.date}-${item.type}-${idx}`} className="border-t border-border/60">
                        <td className="px-3 py-2">{item.date}</td>
                        <td className="px-3 py-2">{item.side === 'buy' ? '买点' : '卖点'}</td>
                        <td className="px-3 py-2">{SIGNAL_LABEL[item.type] || item.type}</td>
                        <td className="px-3 py-2 text-right">{formatNum(item.price, 2)}</td>
                        <td className="px-3 py-2 text-right">{item.side === 'sell' ? formatPct(item.pnlPct, 2) : '--'}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{item.reason || '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

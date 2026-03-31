'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { clientApi } from '@/lib/client-api';
import { compact, signed } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const TABLE_GRID_TEMPLATE = '220px 80px 120px 120px 120px 220px';
const STOCK_MONITOR_FALLBACK_TIMEFRAMES = [
  { key: '30s', label: '30秒', code: null },
  { key: '1m', label: '1分钟', code: '1' },
  { key: '5m', label: '5分钟', code: '5' },
  { key: '15m', label: '15分钟', code: '15' },
  { key: '30m', label: '30分钟', code: '30' },
  { key: '60m', label: '60分钟', code: '60' },
  { key: '1d', label: '日线', code: '101' },
  { key: '1w', label: '周线', code: '102' },
  { key: '1M', label: '月线', code: '103' },
];
const STOCK_MONITOR_DEFAULT_LIMIT_MAP = {
  '1m': 1800,
};
const STOCK_MONITOR_LONG_KLINE_KEYS = new Set(['1d', '1w', '1M']);

function resolveStockMonitorLimit(timeframe = '') {
  const key = String(timeframe || '');
  if (STOCK_MONITOR_DEFAULT_LIMIT_MAP[key]) return STOCK_MONITOR_DEFAULT_LIMIT_MAP[key];
  if (STOCK_MONITOR_LONG_KLINE_KEYS.has(key)) return 100;
  return 120;
}

function duplicateRows(rows, target = 1000) {
  const source = Array.isArray(rows) ? rows : [];
  if (source.length >= target || !source.length) return source;

  const result = [];
  let cursor = 0;
  while (result.length < target) {
    const base = source[cursor % source.length];
    result.push({
      ...base,
      id: `${base.id}-${cursor}`,
      stockCode: `${base.stockCode}`,
      name: `${base.name}`,
    });
    cursor += 1;
  }
  return result;
}

export function StockMonitorTable({ initialData }) {
  const [timeframe, setTimeframe] = useState(initialData?.timeframe || '1m');
  const [timeframes, setTimeframes] = useState(STOCK_MONITOR_FALLBACK_TIMEFRAMES);
  const [stressRows, setStressRows] = useState(false);
  const [flashMap, setFlashMap] = useState({});
  const [categories, setCategories] = useState([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categoryUpdatingMap, setCategoryUpdatingMap] = useState({});
  const [categoryMessage, setCategoryMessage] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const priceMapRef = useRef({});
  const monitorLimit = useMemo(() => resolveStockMonitorLimit(timeframe), [timeframe]);

  const query = useQuery({
    queryKey: ['stock-monitor', timeframe, monitorLimit],
    queryFn: () => clientApi.stockMonitor({ timeframe, limit: monitorLimit }),
    initialData,
    refetchInterval: 30_000,
  });

  const loadCategories = useCallback(async () => {
    setCategoryLoading(true);
    try {
      const payload = await clientApi.stockMonitor.categories();
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setCategories(items);
    } catch (error) {
      setCategoryError(`分类加载失败：${error.message || '未知错误'}`);
    } finally {
      setCategoryLoading(false);
    }
  }, []);

  const loadTimeframes = useCallback(async () => {
    try {
      const payload = await clientApi.stockMonitor.timeframes();
      const items = Array.isArray(payload?.items) ? payload.items : [];
      if (items.length) {
        setTimeframes(items);
      }
    } catch {}
  }, []);

  useEffect(() => {
    loadCategories().catch(() => {});
  }, [loadCategories]);

  useEffect(() => {
    loadTimeframes().catch(() => {});
  }, [loadTimeframes]);

  useEffect(() => {
    if (!Array.isArray(timeframes) || !timeframes.length) return;
    const exists = timeframes.some((item) => item?.key === timeframe);
    if (exists) return;
    const fallbackKey = timeframes.find((item) => item?.key === '30s')?.key
      || timeframes[0]?.key
      || '1m';
    setTimeframe(String(fallbackKey));
  }, [timeframes, timeframe]);

  const rows = useMemo(() => {
    const items = Array.isArray(query.data?.items) ? query.data.items : [];
    const normalized = items.map((item) => ({
      id: item.id,
      name: item.name,
      stockCode: item.stockCode,
      market: item.market,
      price: Number(item.quote?.price ?? 0),
      changePct: Number(item.quote?.changePct ?? 0),
      volume: Number(item.quote?.volume ?? 0),
      fetchedAt: item.quote?.fetchedAt || item.fetchedAt || '--',
      warning: item.warning,
      error: item.error,
    }));
    return stressRows ? duplicateRows(normalized, 1000) : normalized;
  }, [query.data?.items, stressRows]);

  useEffect(() => {
    if (!rows.length) return;

    const changed = {};
    rows.forEach((row) => {
      const key = row.stockCode;
      const current = Number(row.price);
      const prev = priceMapRef.current[key];
      if (Number.isFinite(prev) && Number.isFinite(current) && current !== prev) {
        changed[key] = current > prev ? 'up' : 'down';
      }
      priceMapRef.current[key] = current;
    });

    const keys = Object.keys(changed);
    if (!keys.length) return;

    setFlashMap((prev) => ({ ...prev, ...changed }));
    const timer = setTimeout(() => {
      setFlashMap((prev) => {
        const next = { ...prev };
        keys.forEach((key) => delete next[key]);
        return next;
      });
    }, 450);

    return () => clearTimeout(timer);
  }, [rows]);

  async function toggleCategoryEnabled(category) {
    const id = Number(category?.id || 0);
    if (!Number.isFinite(id) || id <= 0) {
      setCategoryError('分类ID无效，无法切换状态');
      return;
    }

    const nextEnabled = category?.isEnabled === false;
    setCategoryMessage('');
    setCategoryError('');
    setCategoryUpdatingMap((prev) => ({ ...prev, [id]: true }));

    try {
      await clientApi.stockMonitor.updateCategory(id, { isEnabled: nextEnabled });
      await Promise.all([loadCategories(), query.refetch()]);
      setCategoryMessage(`分类「${category?.name || id}」已${nextEnabled ? '开启' : '关闭'}实时监测`);
    } catch (error) {
      setCategoryError(`分类状态更新失败：${error.message || '未知错误'}`);
    } finally {
      setCategoryUpdatingMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  const columns = useMemo(
    () => [
      {
        header: '股票',
        accessorKey: 'name',
        size: 220,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{row.original.name}</p>
            <p className="text-xs text-muted-foreground">{row.original.stockCode}</p>
          </div>
        ),
      },
      {
        header: '市场',
        accessorKey: 'market',
        size: 80,
      },
      {
        header: '最新价',
        accessorKey: 'price',
        size: 120,
        cell: ({ row }) => {
          const flash = flashMap[row.original.stockCode];
          return (
            <span className={flash === 'up' ? 'price-up-flash' : flash === 'down' ? 'price-down-flash' : ''}>
              {row.original.price ? row.original.price.toFixed(2) : '--'}
            </span>
          );
        },
      },
      {
        header: '涨跌幅',
        accessorKey: 'changePct',
        size: 120,
        cell: ({ row }) => {
          const value = Number(row.original.changePct);
          const positive = value >= 0;
          return <span className={positive ? 'text-emerald-600' : 'text-red-600'}>{signed(value, 2, '%')}</span>;
        },
      },
      {
        header: '成交量',
        accessorKey: 'volume',
        size: 120,
        cell: ({ row }) => compact(row.original.volume),
      },
      {
        header: '状态',
        accessorKey: 'error',
        size: 120,
        cell: ({ row }) => {
          if (row.original.error) return <Badge variant="danger">失败</Badge>;
          if (row.original.warning) return <Badge variant="secondary">降级</Badge>;
          return <Badge variant="success">正常</Badge>;
        },
      },
    ],
    [flashMap],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const scrollRef = useRef(null);
  const rowVirtualizer = useVirtualizer({
    count: table.getRowModel().rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 12,
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {timeframes.map((item) => (
          <Button
            key={item.key}
            variant={timeframe === item.key ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTimeframe(item.key)}
          >
            {item.label || item.key}
          </Button>
        ))}
        <label className="ml-1 inline-flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={stressRows} onChange={(e) => setStressRows(e.target.checked)} className="size-4" />
          虚拟化压力测试（1000行）
        </label>
        {query.isFetching ? <Badge variant="outline">刷新中...</Badge> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
        <span className="text-xs text-muted-foreground">分类实时监测开关</span>
        {categories.map((item) => {
          const enabled = item?.isEnabled !== false;
          const busy = Boolean(categoryUpdatingMap[item.id]);
          return (
            <label
              key={item.id}
              className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${
                enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-slate-100 text-slate-600'
              }`}
            >
              <input
                type="checkbox"
                checked={enabled}
                disabled={busy}
                onChange={() => toggleCategoryEnabled(item)}
                className="size-3.5"
              />
              <span>{item.name || '-'}</span>
              <span className="font-medium">{enabled ? '开启' : '关闭'}</span>
            </label>
          );
        })}
        {!categories.length && !categoryLoading ? <span className="text-xs text-muted-foreground">暂无分类</span> : null}
        {categoryLoading ? <Badge variant="outline">分类加载中...</Badge> : null}
      </div>

      {categoryMessage ? <p className="text-xs text-emerald-600">{categoryMessage}</p> : null}
      {categoryError ? <p className="text-xs text-red-600">{categoryError}</p> : null}

      <div className="rounded-xl border border-border/60 bg-card">
        <div className="grid border-b border-border/60 px-4 py-3 text-xs text-muted-foreground" style={{ gridTemplateColumns: TABLE_GRID_TEMPLATE }}>
          {table.getHeaderGroups()[0]?.headers.map((header) => (
            <div key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</div>
          ))}
        </div>

        <div ref={scrollRef} className="h-[560px] overflow-auto">
          <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = table.getRowModel().rows[virtualRow.index];
              return (
                <div
                  key={row.id}
                  className="grid border-b border-border/50 px-4 py-3 text-sm"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    gridTemplateColumns: TABLE_GRID_TEMPLATE,
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <div key={cell.id} className="truncate pr-2">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {query.error ? <p className="text-sm text-red-600">数据加载失败：{query.error.message}</p> : null}
    </div>
  );
}

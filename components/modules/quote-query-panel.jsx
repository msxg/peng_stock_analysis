'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { clientApi } from '@/lib/client-api';

const LONG_KEYS = new Set(['1d', '1w', '1M']);
const INTRADAY_KEYS = new Set(['30s', '1m', '5m', '15m', '30m', '60m']);

function resolveDefaultLimit(timeframe = '1m') {
  const tf = String(timeframe || '1m');
  if (tf === '1m') return 1800;
  if (LONG_KEYS.has(tf)) return 120;
  return 120;
}

function toFixedNumber(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(digits);
}

function toSignedPercent(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

function fmtDateTime(value) {
  if (!value) return '--';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return String(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function countCandles(item) {
  const candles = Array.isArray(item?.candles) ? item.candles : [];
  return candles.length;
}

function firstCandleDate(item) {
  const candles = Array.isArray(item?.candles) ? item.candles : [];
  return candles[0]?.date || '';
}

function lastCandleDate(item) {
  const candles = Array.isArray(item?.candles) ? item.candles : [];
  return candles[candles.length - 1]?.date || '';
}

function hasDateGranularityMismatch(item, reqTimeframe = '') {
  const candles = Array.isArray(item?.candles) ? item.candles : [];
  if (!candles.length) return false;
  const sample = String(candles[0]?.date || '').trim();
  if (!sample) return false;
  const hasClock = /\d{2}:\d{2}/.test(sample);
  const tf = String(item?.timeframe || reqTimeframe || '');
  if (LONG_KEYS.has(tf)) return hasClock;
  if (INTRADAY_KEYS.has(tf)) return !hasClock;
  return false;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[,"\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadFile(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildCsvRows(rows = []) {
  const headers = [
    'categoryName',
    'name',
    'quoteCode',
    'timeframe',
    'timeframeLabel',
    'candlesCount',
    'firstDate',
    'lastDate',
    'candleDataSource',
    'warning',
    'error',
    'price',
    'changePct',
    'quoteFetchedAt',
    'dateGranularityMismatch',
  ];
  const lines = [headers.join(',')];
  rows.forEach((row) => {
    const values = [
      row.categoryName || '',
      row.name || '',
      row.quoteCode || '',
      row.timeframe || '',
      row.timeframeLabel || '',
      row.candlesCount,
      row.firstDate || '',
      row.lastDate || '',
      row.candleDataSource || '',
      row.warning || '',
      row.error || '',
      Number.isFinite(Number(row.quote?.price)) ? Number(row.quote.price) : '',
      Number.isFinite(Number(row.quote?.changePct)) ? Number(row.quote.changePct) : '',
      row.quote?.fetchedAt || row.quote?.tradeTime || '',
      row.dateGranularityMismatch ? '1' : '0',
    ];
    lines.push(values.map(csvEscape).join(','));
  });
  return lines.join('\n');
}

function pickPreviewCandles(candles = [], count = 8) {
  const source = Array.isArray(candles) ? candles : [];
  if (source.length <= count * 2) return source;
  const head = source.slice(0, count);
  const tail = source.slice(-count);
  return [...head, { __separator: true }, ...tail];
}

export function QuoteQueryPanel() {
  const [filters, setFilters] = useState({
    timeframe: '1m',
    limit: resolveDefaultLimit('1m'),
    categoryId: '',
    quoteCode: '',
  });
  const [timeframes, setTimeframes] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState(null);
  const [message, setMessage] = useState('');
  const [onlyWarning, setOnlyWarning] = useState(false);
  const [onlyError, setOnlyError] = useState(false);
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [sortBy, setSortBy] = useState('quoteCode');
  const [sortDir, setSortDir] = useState('asc');
  const [lastQueryAt, setLastQueryAt] = useState('');
  const [inspectItem, setInspectItem] = useState(null);

  const runQuery = useCallback(async (active) => {
    const next = active || {
      timeframe: '1m',
      limit: resolveDefaultLimit('1m'),
      categoryId: '',
      quoteCode: '',
    };
    setLoading(true);
    setMessage('');
    try {
      const params = {
        timeframe: next.timeframe,
        limit: next.limit,
        categoryId: next.categoryId || undefined,
        quoteCode: String(next.quoteCode || '').trim() || undefined,
      };
      const result = await clientApi.futures.monitor(params);
      setPayload(result);
      setLastQueryAt(new Date().toISOString());
      setMessage(
        `查询完成：成功 ${result?.success || 0} / 失败 ${result?.failed || 0} / 总数 ${result?.total || 0}`,
      );
    } catch (error) {
      setMessage(`查询失败：${error.message || '未知错误'}`);
      setPayload(null);
      setLastQueryAt(new Date().toISOString());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      setLoading(true);
      try {
        const [timeframeResp, categoryResp] = await Promise.all([
          clientApi.futures.timeframes(),
          clientApi.futures.categories(),
        ]);
        if (cancelled) return;

        const tfItems = Array.isArray(timeframeResp?.items) ? timeframeResp.items : [];
        const catItems = Array.isArray(categoryResp?.items) ? categoryResp.items : [];
        setTimeframes(tfItems);
        setCategories(catItems);

        const saved = typeof window !== 'undefined'
          ? window.localStorage.getItem('futures.defaultTimeframe') || '1m'
          : '1m';
        const available = new Set(tfItems.map((item) => item.key));
        const initialTf = available.has(saved) ? saved : (tfItems[0]?.key || '1m');
        const initialFilters = {
          timeframe: initialTf,
          limit: resolveDefaultLimit(initialTf),
          categoryId: '',
          quoteCode: '',
        };
        setFilters(initialFilters);
        await runQuery(initialFilters);
      } catch (error) {
        if (cancelled) return;
        setMessage(`初始化失败：${error.message || '未知错误'}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [runQuery]);

  const rows = useMemo(() => {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return items.map((item) => ({
      ...item,
      candlesCount: countCandles(item),
      firstDate: firstCandleDate(item),
      lastDate: lastCandleDate(item),
      dateGranularityMismatch: hasDateGranularityMismatch(item, filters.timeframe),
    }));
  }, [payload?.items, filters.timeframe]);

  const filteredRows = useMemo(() => {
    const kw = String(keyword || '').trim().toUpperCase();
    let next = rows.filter((row) => {
      if (onlyWarning && !row.warning) return false;
      if (onlyError && !row.error) return false;
      if (onlyEmpty && Number(row.candlesCount || 0) > 0) return false;
      if (!kw) return true;
      const searchText = [
        row.quoteCode,
        row.name,
        row.categoryName,
        row.warning,
        row.error,
        row.candleDataSource,
      ]
        .map((part) => String(part || '').toUpperCase())
        .join(' ');
      return searchText.includes(kw);
    });

    const compare = (a, b) => {
      if (sortBy === 'candlesCount') return Number(a.candlesCount || 0) - Number(b.candlesCount || 0);
      if (sortBy === 'lastDate') return String(a.lastDate || '').localeCompare(String(b.lastDate || ''));
      if (sortBy === 'status') {
        const sa = (a.error ? 2 : 0) + (a.warning ? 1 : 0);
        const sb = (b.error ? 2 : 0) + (b.warning ? 1 : 0);
        return sa - sb;
      }
      return String(a.quoteCode || '').localeCompare(String(b.quoteCode || ''));
    };
    next = [...next].sort((a, b) => {
      const v = compare(a, b);
      return sortDir === 'desc' ? -v : v;
    });
    return next;
  }, [rows, keyword, onlyWarning, onlyError, onlyEmpty, sortBy, sortDir]);

  const timeframeLabel = payload?.timeframeLabel || payload?.timeframe || filters.timeframe;

  function handleReset() {
    const next = {
      timeframe: filters.timeframe || '1m',
      limit: resolveDefaultLimit(filters.timeframe || '1m'),
      categoryId: '',
      quoteCode: '',
    };
    setKeyword('');
    setOnlyWarning(false);
    setOnlyError(false);
    setOnlyEmpty(false);
    setSortBy('quoteCode');
    setSortDir('asc');
    setFilters(next);
    runQuery(next).catch(() => {});
  }

  function exportCsv() {
    const csv = buildCsvRows(filteredRows);
    const tf = String(filters.timeframe || 'tf');
    const stamp = String(lastQueryAt || new Date().toISOString()).replace(/[:.]/g, '-');
    downloadFile(`quote-query-${tf}-${stamp}.csv`, csv, 'text/csv;charset=utf-8');
  }

  function exportJson() {
    const snapshot = {
      query: {
        ...filters,
        onlyWarning,
        onlyError,
        onlyEmpty,
        keyword,
        sortBy,
        sortDir,
        queriedAt: lastQueryAt || new Date().toISOString(),
      },
      payload,
      filteredRows,
    };
    const tf = String(filters.timeframe || 'tf');
    const stamp = String(lastQueryAt || new Date().toISOString()).replace(/[:.]/g, '-');
    downloadFile(`quote-query-${tf}-${stamp}.json`, `${JSON.stringify(snapshot, null, 2)}\n`, 'application/json;charset=utf-8');
  }

  const inspectCandles = useMemo(() => pickPreviewCandles(inspectItem?.candles || [], 8), [inspectItem?.candles]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>行情查询（接口验证）</CardTitle>
          <CardDescription>
            使用与“期货监测”相同的接口和参数（/api/v1/futures/monitor），用于表格化核对数据并导出分析。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={filters.timeframe}
              onValueChange={(value) => {
                const next = { ...filters, timeframe: value, limit: resolveDefaultLimit(value) };
                setFilters(next);
              }}
            >
              <SelectTrigger className="w-[120px] min-w-[120px]" style={{ width: '120px', minWidth: '120px' }}>
                <SelectValue placeholder="粒度" />
              </SelectTrigger>
              <SelectContent className="w-[120px] min-w-[120px]" style={{ width: '120px', minWidth: '120px' }}>
                {timeframes.map((item) => (
                  <SelectItem key={item.key} value={item.key}>{item.label || item.key}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              type="number"
              min={20}
              max={4000}
              value={String(filters.limit)}
              onChange={(event) => setFilters((prev) => ({ ...prev, limit: Math.min(Math.max(Number(event.target.value) || 20, 20), 4000) }))}
              className="w-[130px]"
              placeholder="limit"
            />

            <Select
              value={filters.categoryId ? String(filters.categoryId) : '__all__'}
              onValueChange={(value) => setFilters((prev) => ({ ...prev, categoryId: value === '__all__' ? '' : value }))}
            >
              <SelectTrigger className="w-[220px] min-w-[220px]">
                <SelectValue placeholder="全部分类" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部分类</SelectItem>
                {categories.map((item) => (
                  <SelectItem key={String(item.id)} value={String(item.id)}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              value={filters.quoteCode}
              onChange={(event) => setFilters((prev) => ({ ...prev, quoteCode: event.target.value }))}
              className="w-[280px]"
              placeholder="quoteCode：101.SI00Y 或 101.SI00Y,113.AU2604"
            />

            <Button onClick={() => runQuery(filters).catch(() => {})} disabled={loading}>查询</Button>
            <Button variant="outline" onClick={handleReset} disabled={loading}>重置</Button>
            <Button variant="outline" onClick={exportCsv} disabled={!filteredRows.length}>导出 CSV</Button>
            <Button variant="outline" onClick={exportJson} disabled={!payload}>导出 JSON</Button>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1 text-muted-foreground">
              <input type="checkbox" checked={onlyWarning} onChange={(event) => setOnlyWarning(event.target.checked)} />
              仅 warning
            </label>
            <label className="flex items-center gap-1 text-muted-foreground">
              <input type="checkbox" checked={onlyError} onChange={(event) => setOnlyError(event.target.checked)} />
              仅 error
            </label>
            <label className="flex items-center gap-1 text-muted-foreground">
              <input type="checkbox" checked={onlyEmpty} onChange={(event) => setOnlyEmpty(event.target.checked)} />
              仅空K线
            </label>
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索 code / name / warning / error"
              className="w-[320px]"
            />
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-[140px] min-w-[140px]">
                <SelectValue placeholder="排序字段" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="quoteCode">按代码</SelectItem>
                <SelectItem value="candlesCount">按K线数</SelectItem>
                <SelectItem value="lastDate">按末条时间</SelectItem>
                <SelectItem value="status">按状态</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortDir} onValueChange={setSortDir}>
              <SelectTrigger className="w-[110px] min-w-[110px]">
                <SelectValue placeholder="顺序" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="asc">升序</SelectItem>
                <SelectItem value="desc">降序</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>查询摘要</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">请求粒度</p>
              <p className="text-sm font-semibold">{timeframeLabel}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">总数</p>
              <p className="text-sm font-semibold">{payload?.total ?? 0}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">成功/失败</p>
              <p className="text-sm font-semibold">{payload?.success ?? 0} / {payload?.failed ?? 0}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">当前列表</p>
              <p className="text-sm font-semibold">{filteredRows.length}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">查询时间</p>
              <p className="text-sm font-semibold">{fmtDateTime(lastQueryAt)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>结果表格</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[620px] overflow-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted/60 text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-3 py-2 text-left">分类</th>
                  <th className="px-3 py-2 text-left">品种</th>
                  <th className="px-3 py-2 text-left">代码</th>
                  <th className="px-3 py-2 text-left">粒度</th>
                  <th className="px-3 py-2 text-left">K线数</th>
                  <th className="px-3 py-2 text-left">首条</th>
                  <th className="px-3 py-2 text-left">末条</th>
                  <th className="px-3 py-2 text-left">数据源</th>
                  <th className="px-3 py-2 text-left">一致性</th>
                  <th className="px-3 py-2 text-left">warning</th>
                  <th className="px-3 py-2 text-left">error</th>
                  <th className="px-3 py-2 text-left">最新价</th>
                  <th className="px-3 py-2 text-left">涨跌%</th>
                  <th className="px-3 py-2 text-left">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.id} className="border-t border-border/40 align-top">
                    <td className="px-3 py-2">{row.categoryName || '--'}</td>
                    <td className="px-3 py-2">{row.name || '--'}</td>
                    <td className="px-3 py-2 font-mono">{row.quoteCode || '--'}</td>
                    <td className="px-3 py-2">{row.timeframeLabel || row.timeframe || '--'}</td>
                    <td className="px-3 py-2">{row.candlesCount}</td>
                    <td className="px-3 py-2 font-mono">{row.firstDate || '--'}</td>
                    <td className="px-3 py-2 font-mono">{row.lastDate || '--'}</td>
                    <td className="px-3 py-2">{row.candleDataSource || '--'}</td>
                    <td className="px-3 py-2">
                      {row.dateGranularityMismatch ? (
                        <span className="rounded bg-rose-100 px-2 py-0.5 text-xs text-rose-700">日期粒度异常</span>
                      ) : (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">正常</span>
                      )}
                    </td>
                    <td className="max-w-[320px] px-3 py-2 text-amber-700">{row.warning || '--'}</td>
                    <td className="max-w-[320px] px-3 py-2 text-rose-700">{row.error || '--'}</td>
                    <td className="px-3 py-2">{toFixedNumber(row.quote?.price)}</td>
                    <td className="px-3 py-2">{toSignedPercent(row.quote?.changePct)}</td>
                    <td className="px-3 py-2">
                      <Button size="sm" variant="outline" onClick={() => setInspectItem(row)}>查看K线</Button>
                    </td>
                  </tr>
                ))}
                {!filteredRows.length ? (
                  <tr>
                    <td colSpan={14} className="px-3 py-8 text-center text-muted-foreground">当前条件下没有结果</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {inspectItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setInspectItem(null)}>
          <div
            className="w-[min(96vw,1100px)] rounded-2xl border border-border/70 bg-background shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
              <h3 className="text-lg font-semibold">
                K线样本：{inspectItem.name || inspectItem.quoteCode}（{inspectItem.timeframeLabel || inspectItem.timeframe || '--'}）
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setInspectItem(null)}>关闭</Button>
            </div>
            <div className="space-y-3 p-5">
              <p className="text-sm text-muted-foreground">
                总根数：{countCandles(inspectItem)}；数据源：{inspectItem.candleDataSource || '--'}；最后更新时间：{fmtDateTime(lastQueryAt)}
              </p>
              <div className="max-h-[460px] overflow-auto rounded-lg border border-border/60">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">date</th>
                      <th className="px-3 py-2 text-left">open</th>
                      <th className="px-3 py-2 text-left">high</th>
                      <th className="px-3 py-2 text-left">low</th>
                      <th className="px-3 py-2 text-left">close</th>
                      <th className="px-3 py-2 text-left">volume</th>
                      <th className="px-3 py-2 text-left">amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspectCandles.map((item, idx) => (
                      item?.__separator ? (
                        <tr key={`sep-${idx}`} className="border-t border-border/40">
                          <td colSpan={7} className="px-3 py-3 text-center text-xs text-muted-foreground">...... 省略中间数据 ......</td>
                        </tr>
                      ) : (
                        <tr key={`${item?.date || 'na'}-${idx}`} className="border-t border-border/40">
                          <td className="px-3 py-2 font-mono">{item?.date || '--'}</td>
                          <td className="px-3 py-2">{toFixedNumber(item?.open)}</td>
                          <td className="px-3 py-2">{toFixedNumber(item?.high)}</td>
                          <td className="px-3 py-2">{toFixedNumber(item?.low)}</td>
                          <td className="px-3 py-2">{toFixedNumber(item?.close)}</td>
                          <td className="px-3 py-2">{toFixedNumber(item?.volume, 0)}</td>
                          <td className="px-3 py-2">{toFixedNumber(item?.amount, 0)}</td>
                        </tr>
                      )
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

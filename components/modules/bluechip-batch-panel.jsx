'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, Download, Loader2, Save, Search } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { clientApi } from '@/lib/client-api';

const INDEX_OPTIONS = [
  { value: 'AVG_CN', label: '平均股价' },
  { value: 'SH000001', label: '上证指数' },
  { value: 'SZ399001', label: '深证成指' },
  { value: 'SH000300', label: '沪深300' },
];

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

const SIGNAL_LABEL = {
  index_linked_start_buy: '指数联动起涨买点',
  stock_independent_start_buy: '个股独立起涨买点',
  stop_loss: '止损卖点',
  take_profit: '止盈卖点',
  break_medium: '跌破中阳',
  lose_long_half: '跌破长阳半体',
  fail_prev_high: '不过前高',
};

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeParams(input = {}) {
  const next = {};
  Object.keys(LOCAL_DEFAULTS).forEach((key) => {
    if (key === 'longHalfReferenceMode') {
      const raw = String(input[key] || LOCAL_DEFAULTS[key]).trim();
      next[key] = raw === 'first_long_bull_after_start_buy' ? raw : 'recent_long_bull';
      return;
    }
    next[key] = toNum(input[key], LOCAL_DEFAULTS[key]);
  });
  return next;
}

function splitCodes(text = '') {
  return Array.from(
    new Set(
      String(text || '')
        .split(/[\n,;，；\s]+/)
        .map((item) => String(item || '').trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

function fmtPct(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

export function BluechipBatchPanel() {
  const [defaultsLoaded, setDefaultsLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState('');
  const [message, setMessage] = useState('');

  const [sourceValue, setSourceValue] = useState('manual');
  const [poolCode, setPoolCode] = useState('');
  const [batchPools, setBatchPools] = useState([]);
  const [codesText, setCodesText] = useState('600519, 000333, 300750');

  const [indexCode, setIndexCode] = useState('AVG_CN');
  const [concurrency, setConcurrency] = useState(3);
  const [params, setParams] = useState(LOCAL_DEFAULTS);

  const [result, setResult] = useState(null);
  const [activeTab, setActiveTab] = useState('signals');
  const [keyword, setKeyword] = useState('');
  const [saving, setSaving] = useState(false);

  async function refreshPoolData() {
    const payload = await clientApi.strategy.bluechipPools();
    const pools = Array.isArray(payload?.items) ? payload.items : [];
    const enabledSummaries = pools
      .filter((item) => item?.isEnabled !== false)
      .map((item) => ({
        id: item.id,
        code: item.code,
        name: item.name,
        description: item.description || '',
        count: Array.isArray(item.symbols)
          ? item.symbols.filter((sym) => sym?.isActive !== false).length
          : Number(item.count || 0),
      }));
    setBatchPools(enabledSummaries);
    if (sourceValue !== 'manual' && !enabledSummaries.find((item) => item.code === sourceValue)) {
      setSourceValue('manual');
    }
  }

  useEffect(() => {
    let canceled = false;
    Promise.all([
      clientApi.strategy.bluechipDefaults().catch(() => ({})),
      refreshPoolData().catch(() => null),
    ])
      .then(([defaultsPayload]) => {
        if (canceled) return;
        setParams((prev) => ({ ...prev, ...normalizeParams(defaultsPayload?.defaults || {}) }));
        setDefaultsLoaded(true);
      })
      .catch(() => {
        if (canceled) return;
        setDefaultsLoaded(true);
      });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (sourceValue === 'manual') {
      setPoolCode('');
      return;
    }
    setPoolCode(sourceValue);
  }, [sourceValue]);

  const codeCount = useMemo(() => splitCodes(codesText).length, [codesText]);
  const selectedBatchPool = useMemo(
    () => batchPools.find((item) => item.code === poolCode) || null,
    [batchPools, poolCode],
  );

  const filteredSignals = useMemo(() => {
    const rows = Array.isArray(result?.signals) ? result.signals : [];
    const q = String(keyword || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((item) => {
      const fields = [item.code, item.name, item.type, SIGNAL_LABEL[item.type] || '', item.reason, item.date]
        .map((v) => String(v || '').toLowerCase());
      return fields.some((v) => v.includes(q));
    });
  }, [result?.signals, keyword]);

  const filteredStocks = useMemo(() => {
    const rows = Array.isArray(result?.stocks) ? result.stocks : [];
    const q = String(keyword || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((item) => {
      const fields = [
        item.code,
        item.name,
        item.error,
        item.latestSignal?.type,
        SIGNAL_LABEL[item.latestSignal?.type] || '',
        item.latestSignal?.reason,
      ]
        .map((v) => String(v || '').toLowerCase());
      return fields.some((v) => v.includes(q));
    });
  }, [result?.stocks, keyword]);

  async function runBatchAnalyze(nextMode = 'history') {
    const analysisMode = String(nextMode || 'history').trim().toLowerCase() === 'today' ? 'today' : 'history';
    if (sourceValue === 'manual' && codeCount <= 0) {
      setMessage('请先输入股票代码后再批量分析');
      return;
    }
    if (sourceValue !== 'manual' && !poolCode) {
      setMessage('请先选择标的池');
      return;
    }
    const estimatedCount = sourceValue === 'manual' ? codeCount : (selectedBatchPool?.count || 0);
    const timeoutMs = Math.min(
      30 * 60 * 1000,
      Math.max(
        2 * 60 * 1000,
        estimatedCount * 3000,
      ),
    );
    const resolvedMode = sourceValue === 'manual' ? 'manual' : 'pool';
    const resolvedPoolCode = sourceValue === 'manual' ? '' : poolCode;
    setLoading(true);
    setLoadingMode(analysisMode);
    setMessage('');
    setResult(null);
    try {
      const payload = await clientApi.strategy.bluechipBatchAnalyze({
        analysisMode,
        mode: resolvedMode,
        poolCode: resolvedPoolCode,
        codesText,
        indexCode,
        concurrency,
        days: toNum(params.days, LOCAL_DEFAULTS.days),
        params: normalizeParams(params),
      }, { timeoutMs });
      setResult(payload);
      setActiveTab('signals');
      setMessage(`${analysisMode === 'today' ? '今日分析' : '批量分析'}完成：成功 ${payload?.stats?.success || 0} / ${payload?.stats?.total || 0}，当日有信号 ${payload?.stats?.withTodaySignal || 0} 只`);
    } catch (error) {
      setMessage(`${analysisMode === 'today' ? '今日分析' : '批量分析'}失败：${error.message || '未知错误'}`);
    } finally {
      setLoading(false);
      setLoadingMode('');
    }
  }

  function exportResultExcel() {
    const signalRows = Array.isArray(result?.signals) ? result.signals : [];
    const stockRows = Array.isArray(result?.stocks) ? result.stocks : [];
    if (!signalRows.length && !stockRows.length) {
      setMessage('当前没有可导出的分析结果');
      return;
    }

    const workbook = XLSX.utils.book_new();
    const signalSheet = XLSX.utils.json_to_sheet(signalRows.map((item) => ({
      日期: item.date || '',
      代码: item.code || '',
      名称: item.name || '',
      方向: item.side === 'buy' ? '买点' : '卖点',
      类型: SIGNAL_LABEL[item.type] || item.type || '',
      价格: Number.isFinite(Number(item.price)) ? Number(item.price) : '',
      原因: item.reason || '',
      浮盈亏百分比: Number.isFinite(Number(item.pnlPct)) ? Number(item.pnlPct) : '',
    })));
    const stockSheet = XLSX.utils.json_to_sheet(stockRows.map((item) => ({
      代码: item.code || '',
      名称: item.name || '',
      状态: item.ok ? '成功' : '失败',
      有信号: item.hasSignal ? '是' : '否',
      当日信号: item.hasTodaySignal ? '是' : '否',
      信号数: item.signalCount ?? 0,
      最新信号: SIGNAL_LABEL[item.latestSignal?.type] || item.latestSignal?.type || item.error || '',
      浮盈亏百分比: Number.isFinite(Number(item.summary?.openPosition?.floatingPnlPct))
        ? Number(item.summary.openPosition.floatingPnlPct)
        : '',
      当日日期: item.today || '',
    })));

    XLSX.utils.book_append_sheet(workbook, signalSheet, '信号列表');
    XLSX.utils.book_append_sheet(workbook, stockSheet, '股票列表');

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    XLSX.writeFile(workbook, `bluechip-batch-analysis-${stamp}.xlsx`);
    setMessage('已导出 Excel 文件（含“信号列表 / 股票列表”两个 sheet）');
  }

  async function saveSignalsToDb() {
    const signalRows = Array.isArray(result?.signals) ? result.signals : [];
    if (!signalRows.length) {
      setMessage('当前没有信号数据可保存');
      return;
    }

    setSaving(true);
    try {
      const payload = await clientApi.strategy.saveBluechipBatchSignals({
        request: result?.request || {},
        index: result?.index || {},
        signals: signalRows,
        params: normalizeParams(params),
      });
      setMessage(`保存成功：批次 ${payload?.batchId || '--'}，写入 ${payload?.insertedCount || 0} 条信号`);
    } catch (error) {
      setMessage(`保存失败：${error.message || '未知错误'}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold md:text-2xl">蓝筹模式批量分析</h1>
          <p className="mt-1 text-sm text-muted-foreground">批量扫描股票，输出买卖信号与个股分析摘要。</p>
        </div>
        <Link href="/bluechip-mode" className="inline-flex">
          <Button variant="outline">
            <ArrowLeft className="size-4" />
            返回蓝筹模式
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>分析配置</CardTitle>
              <CardDescription>支持手动输入代码或标的池批量分析，可调整策略参数。</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild type="button" variant="outline">
                <Link href="/bluechip-results">分析记录</Link>
              </Button>
              <Button asChild type="button" variant="outline">
                <Link href="/bluechip-pool-config">标的池配置</Link>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">标的来源</label>
              <Select value={sourceValue} onValueChange={setSourceValue}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择来源" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">手动输入代码</SelectItem>
                  {batchPools.map((item) => (
                    <SelectItem key={item.code} value={item.code}>
                      {item.name}（{item.count}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">代码数量</label>
              <Input value={String(sourceValue === 'manual' ? codeCount : (selectedBatchPool?.count || 0))} readOnly />
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
          </div>

          {sourceValue === 'manual' ? (
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">股票代码（逗号/空格/换行分隔）</label>
              <textarea
                value={codesText}
                onChange={(event) => setCodesText(event.target.value)}
                className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="例如：600519, 000333, 300750"
              />
            </div>
          ) : (
            <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              当前标的池：{selectedBatchPool?.name || '--'}（{selectedBatchPool?.code || '--'}），代码数 {selectedBatchPool?.count || 0}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">日线周期(天)</label>
              <Input
                type="number"
                value={params.days}
                onChange={(event) => setParams((prev) => ({ ...prev, days: event.target.value === '' ? '' : Number(event.target.value) }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">指数阶段跌幅(%)</label>
              <Input
                type="number"
                value={params.indexDropPct}
                onChange={(event) => setParams((prev) => ({ ...prev, indexDropPct: event.target.value === '' ? '' : Number(event.target.value) }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">个股阶段跌幅(%)</label>
              <Input
                type="number"
                value={params.stockStartDropPct}
                onChange={(event) => setParams((prev) => ({ ...prev, stockStartDropPct: event.target.value === '' ? '' : Number(event.target.value) }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">指数中阳阈值(%)</label>
              <Input
                type="number"
                value={params.indexStartCandlePct}
                onChange={(event) => setParams((prev) => ({ ...prev, indexStartCandlePct: event.target.value === '' ? '' : Number(event.target.value) }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">止损(%)</label>
              <Input
                type="number"
                value={params.stopLossPct}
                onChange={(event) => setParams((prev) => ({ ...prev, stopLossPct: event.target.value === '' ? '' : Number(event.target.value) }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">止盈(%)</label>
              <Input
                type="number"
                value={params.takeProfitPct}
                onChange={(event) => setParams((prev) => ({ ...prev, takeProfitPct: event.target.value === '' ? '' : Number(event.target.value) }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">不过前高容忍天数</label>
              <Input
                type="number"
                value={params.failPrevHighDays}
                onChange={(event) => setParams((prev) => ({ ...prev, failPrevHighDays: event.target.value === '' ? '' : Number(event.target.value) }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">并发数</label>
              <Input
                type="number"
                value={concurrency}
                onChange={(event) => setConcurrency(event.target.value === '' ? '' : Number(event.target.value))}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">主板中阳阈值(%)</label>
              <Input
                type="number"
                value={params.mediumBullPctMain}
                onChange={(event) => setParams((prev) => ({ ...prev, mediumBullPctMain: event.target.value === '' ? '' : Number(event.target.value) }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">主板长阳阈值(%)</label>
              <Input
                type="number"
                value={params.longBullPctMain}
                onChange={(event) => setParams((prev) => ({ ...prev, longBullPctMain: event.target.value === '' ? '' : Number(event.target.value) }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">创科中阳阈值(%)</label>
              <Input
                type="number"
                value={params.mediumBullPctGrowth}
                onChange={(event) => setParams((prev) => ({ ...prev, mediumBullPctGrowth: event.target.value === '' ? '' : Number(event.target.value) }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">创科长阳阈值(%)</label>
              <Input
                type="number"
                value={params.longBullPctGrowth}
                onChange={(event) => setParams((prev) => ({ ...prev, longBullPctGrowth: event.target.value === '' ? '' : Number(event.target.value) }))}
              />
            </div>
          </div>

          <div className="grid items-end gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">长阳半体参考算法</label>
              <Select
                value={String(params.longHalfReferenceMode || LOCAL_DEFAULTS.longHalfReferenceMode)}
                onValueChange={(value) => setParams((prev) => ({ ...prev, longHalfReferenceMode: value }))}
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
            </div>
            <div>
              <label className="mb-1 block text-xs text-transparent select-none" aria-hidden="true">操作</label>
              <Button className="w-full" disabled={loading || !defaultsLoaded} onClick={() => runBatchAnalyze('today')}>
                {loading && loadingMode === 'today' ? <Loader2 className="size-4 animate-spin" /> : <BarChart3 className="size-4" />}
                {loading && loadingMode === 'today' ? '分析中...' : '开始今日分析'}
              </Button>
            </div>
            <div>
              <label className="mb-1 block text-xs text-transparent select-none" aria-hidden="true">操作</label>
              <Button className="w-full" disabled={loading || !defaultsLoaded} onClick={() => runBatchAnalyze('history')}>
                {loading && loadingMode === 'history' ? <Loader2 className="size-4 animate-spin" /> : <BarChart3 className="size-4" />}
                {loading && loadingMode === 'history' ? '分析中...' : '开始批量分析'}
              </Button>
            </div>
          </div>

          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>分析结果</CardTitle>
            <CardDescription>
              指数：{result?.index?.name || result?.index?.code || '--'}
              ，模式：{result?.request?.analysisMode === 'today' ? '今日分析' : '历史分析'}
              ，成功 {result?.stats?.success || 0}/{result?.stats?.total || 0}
              ，有信号 {result?.stats?.withSignal || 0}
              ，当日有信号 {result?.stats?.withTodaySignal || 0}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-lg border border-border p-1">
                <button
                  type="button"
                  className={`rounded-md px-3 py-1.5 text-sm ${activeTab === 'signals' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                  onClick={() => setActiveTab('signals')}
                >
                  信号列表（{Array.isArray(result?.signals) ? result.signals.length : 0}）
                </button>
                <button
                  type="button"
                  className={`rounded-md px-3 py-1.5 text-sm ${activeTab === 'stocks' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                  onClick={() => setActiveTab('stocks')}
                >
                  股票列表（{Array.isArray(result?.stocks) ? result.stocks.length : 0}）
                </button>
              </div>

              <div className="flex w-full items-center gap-2 md:w-auto">
                <div className="relative flex-1 md:w-72">
                  <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="搜索代码/名称/信号"
                    className="pl-9"
                  />
                </div>
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => saveSignalsToDb().catch(() => {})}
                  disabled={saving || loading || !Array.isArray(result?.signals) || result.signals.length === 0}
                >
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  保存
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  onClick={exportResultExcel}
                  disabled={loading || ((result?.signals?.length || 0) + (result?.stocks?.length || 0) <= 0)}
                >
                  <Download className="size-4" />
                  导出
                </Button>
              </div>
            </div>

            {activeTab === 'signals' ? (
              <div className="max-h-[520px] overflow-auto rounded-lg border border-border/70">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-background text-xs text-muted-foreground shadow-[inset_0_-1px_0_hsl(var(--border))]">
                    <tr>
                      <th className="px-3 py-2 text-left">日期</th>
                      <th className="px-3 py-2 text-left">代码</th>
                      <th className="px-3 py-2 text-left">名称</th>
                      <th className="px-3 py-2 text-left">方向</th>
                      <th className="px-3 py-2 text-left">类型</th>
                      <th className="px-3 py-2 text-right">价格</th>
                      <th className="px-3 py-2 text-left">原因</th>
                      <th className="px-3 py-2 text-left">详情</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSignals.length === 0 ? (
                      <tr>
                        <td className="px-3 py-4 text-center text-muted-foreground" colSpan={8}>暂无信号</td>
                      </tr>
                    ) : null}
                    {filteredSignals.map((item, idx) => (
                      <tr key={`${item.code}-${item.date}-${item.type}-${idx}`} className="border-t border-border/60">
                        <td className="px-3 py-2">{item.date}</td>
                        <td className="px-3 py-2 font-medium">{item.code}</td>
                        <td className="px-3 py-2">{item.name || '--'}</td>
                        <td className={`px-3 py-2 font-medium ${item.side === 'buy' ? 'text-emerald-600' : 'text-red-600'}`}>
                          {item.side === 'buy' ? '买点' : '卖点'}
                        </td>
                        <td className="px-3 py-2">{SIGNAL_LABEL[item.type] || item.type || '--'}</td>
                        <td className="px-3 py-2 text-right">{Number.isFinite(Number(item.price)) ? Number(item.price).toFixed(2) : '--'}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{item.reason || '--'}</td>
                        <td className="px-3 py-2">
                          <Link
                            className="text-primary hover:underline"
                            href={`/bluechip-mode?code=${encodeURIComponent(item.code || '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            查看
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="max-h-[520px] overflow-auto rounded-lg border border-border/70">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-background text-xs text-muted-foreground shadow-[inset_0_-1px_0_hsl(var(--border))]">
                    <tr>
                      <th className="px-3 py-2 text-left">代码</th>
                      <th className="px-3 py-2 text-left">名称</th>
                      <th className="px-3 py-2 text-left">状态</th>
                      <th className="px-3 py-2 text-center">有信号</th>
                      <th className="px-3 py-2 text-center">当日信号</th>
                      <th className="px-3 py-2 text-center">信号数</th>
                      <th className="px-3 py-2 text-left">最新信号</th>
                      <th className="px-3 py-2 text-right">浮盈亏</th>
                      <th className="px-3 py-2 text-left">详情</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStocks.length === 0 ? (
                      <tr>
                        <td className="px-3 py-4 text-center text-muted-foreground" colSpan={9}>暂无结果</td>
                      </tr>
                    ) : null}
                    {filteredStocks.map((item) => (
                      <tr key={item.code} className="border-t border-border/60">
                        <td className="px-3 py-2 font-medium">{item.code}</td>
                        <td className="px-3 py-2">{item.name || '--'}</td>
                        <td className="px-3 py-2">{item.ok ? '成功' : '失败'}</td>
                        <td className={`px-3 py-2 text-center ${item.hasSignal ? 'font-semibold text-red-600' : ''}`}>
                          {item.hasSignal ? '是' : '否'}
                        </td>
                        <td className={`px-3 py-2 text-center ${item.hasTodaySignal ? 'font-semibold text-red-600' : ''}`}>
                          {item.hasTodaySignal ? '是' : '否'}
                        </td>
                        <td className="px-3 py-2 text-center">{item.signalCount ?? 0}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{SIGNAL_LABEL[item.latestSignal?.type] || item.latestSignal?.type || item.error || '--'}</td>
                        <td className="px-3 py-2 text-right">{fmtPct(item.summary?.openPosition?.floatingPnlPct, 2)}</td>
                        <td className="px-3 py-2">
                          <Link
                            className="text-primary hover:underline"
                            href={`/bluechip-mode?code=${encodeURIComponent(item.code || '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            查看
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

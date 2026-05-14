'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { clientApi } from '@/lib/client-api';

const SYNC_TIMEFRAME_RULES = {
  futures: {
    '1m': { maxDays: 7, label: '分钟' },
    '1d': { label: '日' },
    '1w': { label: '周' },
    '1M': { label: '月' },
  },
  stock: {
    '1d': { label: '日' },
  },
};

const TIMEFRAME_OPTIONS = [
  { value: '1m', label: '分钟' },
  { value: '1d', label: '日' },
  { value: '1w', label: '周' },
  { value: '1M', label: '月' },
];

const SYMBOL_TYPE_OPTIONS = [
  { value: 'futures', label: '期货' },
  { value: 'stock', label: '股票' },
];

const JOBS_AUTO_REFRESH_OPTIONS = [
  { value: 30000, label: '30秒' },
  { value: 60000, label: '1分钟' },
  { value: 300000, label: '5分钟' },
];

const CN_A_SHARE_EARLIEST_DAY = '1990-12-19';

function getTimeframeLabel(key) {
  const found = TIMEFRAME_OPTIONS.find((item) => item.value === key);
  return found?.label || key || '--';
}

function getSyncJobTypeLabel(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'sync') return '同步';
  return value || '--';
}

function getSyncJobSymbolTypeLabel(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'stock') return '股票';
  if (key === 'futures') return '期货';
  return value || '--';
}

function getSyncJobStatusLabel(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'success') return '成功';
  if (key === 'failed') return '失败';
  if (key === 'partial_failed') return '部分失败';
  if (key === 'running') return '运行中';
  if (key === 'queued') return '排队中';
  if (key === 'cancelled') return '已取消';
  return value || '--';
}

function formatNumber(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(digits);
}

function formatPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${n.toFixed(2)}%`;
}

function formatInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return Math.round(n).toLocaleString();
}

function formatGap(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  const seconds = Math.round(n);
  if (seconds >= 86400) return `${Math.round(seconds / 86400)}d`;
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
  return `${seconds}s`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateInput(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function shiftDay(dayText, offsetDays) {
  const text = String(dayText || '');
  const [y, m, d] = text.split('-').map((item) => Number(item));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return '';
  const date = new Date(y, m - 1, d);
  if (!Number.isFinite(date.getTime())) return '';
  date.setDate(date.getDate() + Number(offsetDays || 0));
  return formatDateInput(date);
}

function normalizeDateText(value) {
  const text = String(value || '').trim().replace(/\//g, '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function clampDateText(value, minDay, maxDay) {
  const normalized = normalizeDateText(value);
  if (!normalized) return maxDay || minDay || '';
  if (minDay && normalized < minDay) return minDay;
  if (maxDay && normalized > maxDay) return maxDay;
  return normalized;
}

const DEFAULT_END_DAY = formatDateInput(new Date());
const DEFAULT_START_DAY = shiftDay(DEFAULT_END_DAY, -120);

export function MarketDataPanel() {
  const [activeTab, setActiveTab] = useState('audit');
  const [filters, setFilters] = useState({
    symbolType: 'stock',
    timeframe: '1d',
    startDay: DEFAULT_START_DAY,
    endDay: DEFAULT_END_DAY,
    quoteCode: '',
    limit: 200,
  });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [payload, setPayload] = useState(null);
  const [jobsPayload, setJobsPayload] = useState({ items: [], pagination: null });
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsMessage, setJobsMessage] = useState('');
  const [jobsPage, setJobsPage] = useState(1);
  const [jobsLimit, setJobsLimit] = useState(10);
  const [jobsAutoRefreshMs, setJobsAutoRefreshMs] = useState(30000);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncConfirmMode, setSyncConfirmMode] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncPhase, setSyncPhase] = useState('idle');
  const [pendingSyncPlan, setPendingSyncPlan] = useState(null);
  const [syncDialogError, setSyncDialogError] = useState('');
  const [syncForm, setSyncForm] = useState({
    syncRange: 'single_day',
    tradeDay: '',
  });

  const query = useCallback(async ({ nextPage = 1, nextFilters } = {}) => {
    const activeFilters = nextFilters || filters;
    setLoading(true);
    setMessage('');
    try {
      const result = await clientApi.system.marketData({
        symbolType: activeFilters.symbolType,
        timeframe: activeFilters.timeframe,
        startDay: activeFilters.startDay,
        endDay: activeFilters.endDay,
        quoteCode: activeFilters.quoteCode,
        page: nextPage,
        limit: activeFilters.limit,
      });
      setPayload(result);
      setPage(Number(result?.pagination?.page || nextPage));
      if (!activeFilters.startDay && !activeFilters.endDay && (result?.filters?.startDay || result?.filters?.endDay)) {
        setFilters((prev) => {
          if (prev.startDay || prev.endDay) return prev;
          return {
            ...prev,
            startDay: result?.filters?.startDay || '',
            endDay: result?.filters?.endDay || '',
          };
        });
      }
      setMessage(
        `查询完成：${formatInt(result?.pagination?.total || 0)} 条，` +
        `${formatInt(result?.summary?.symbolCount || 0)} 个品种，` +
        `完整率 ${formatPercent(result?.summary?.completenessPct || 0)}（${result?.dataset || '--'}${result?.summary?.overviewMode === 'light' ? '，快速模式' : ''}）`,
      );
    } catch (error) {
      setMessage(`查询失败：${error.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadJobs = useCallback(async ({ silent = false, nextPage, nextLimit } = {}) => {
    const pageToQuery = Math.max(Number(nextPage || jobsPage) || 1, 1);
    const limitToQuery = Math.min(Math.max(Number(nextLimit || jobsLimit) || 10, 10), 200);
    if (!silent) {
      setJobsLoading(true);
      setJobsMessage('');
    }
    try {
      const result = await clientApi.system.marketDataJobs({
        page: pageToQuery,
        limit: limitToQuery,
      });
      setJobsPayload(result || { items: [], pagination: null });
      setJobsPage(Number(result?.pagination?.page || pageToQuery));
      setJobsLimit(Number(result?.pagination?.limit || limitToQuery));
      if (!silent) {
        setJobsMessage(`任务加载完成：${formatInt(result?.pagination?.total || result?.items?.length || 0)} 条`);
      }
    } catch (error) {
      if (!silent) {
        setJobsMessage(`任务加载失败：${error.message || '未知错误'}`);
      }
    } finally {
      if (!silent) setJobsLoading(false);
    }
  }, [jobsLimit, jobsPage]);

  useEffect(() => {
    query({ nextPage: 1, nextFilters: filters }).catch(() => {});
    loadJobs({ silent: true, nextPage: 1, nextLimit: jobsLimit }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const items = Array.isArray(jobsPayload?.items) ? jobsPayload.items : [];
    const hasRunning = items.some((item) => ['running', 'queued', 'partial_failed'].includes(String(item?.status || '')));
    if (!hasRunning) return undefined;

    const timer = window.setInterval(() => {
      loadJobs({ silent: true, nextPage: jobsPage, nextLimit: jobsLimit }).catch(() => {});
    }, jobsAutoRefreshMs);
    return () => window.clearInterval(timer);
  }, [jobsAutoRefreshMs, jobsLimit, jobsPage, jobsPayload, loadJobs]);

  const pagination = payload?.pagination || { page: 1, totalPages: 0, total: 0 };
  const canPrev = Number(pagination.page || 1) > 1;
  const canNext = Number(pagination.page || 1) < Number(pagination.totalPages || 0);
  const jobsPagination = jobsPayload?.pagination || { page: jobsPage, totalPages: 0, total: 0, limit: jobsLimit };
  const jobsCanPrev = Number(jobsPagination.page || 1) > 1;
  const jobsCanNext = Number(jobsPagination.page || 1) < Number(jobsPagination.totalPages || 0);
  const todayText = formatDateInput(new Date());
  const syncRule = SYNC_TIMEFRAME_RULES[filters.symbolType]?.[filters.timeframe] || null;
  const hasSyncLookbackLimit = Number.isFinite(Number(syncRule?.maxDays)) && Number(syncRule.maxDays) > 0;
  const earliestSyncDay = hasSyncLookbackLimit ? shiftDay(todayText, -(Number(syncRule.maxDays) - 1)) : '';
  const activeStartDay = payload?.filters?.startDay || filters.startDay || '';
  const activeEndDay = payload?.filters?.endDay || filters.endDay || '';

  function openSyncDialog() {
    const baseDay = filters.startDay || filters.endDay || payload?.filters?.startDay || payload?.filters?.endDay || todayText;
    const clampedDay = clampDateText(baseDay, earliestSyncDay, todayText);
    setSyncForm({
      syncRange: 'single_day',
      tradeDay: clampedDay,
    });
    setSyncDialogError('');
    setSyncConfirmMode(false);
    setPendingSyncPlan(null);
    setSyncDialogOpen(true);
  }

  function closeSyncDialog() {
    if (syncing) return;
    setSyncDialogOpen(false);
    setSyncConfirmMode(false);
    setPendingSyncPlan(null);
    setSyncDialogError('');
  }

  function openSyncConfirm() {
    setSyncDialogError('');
    if (!syncRule) {
      setSyncDialogError(`当前粒度 ${getTimeframeLabel(filters.timeframe)} 暂不支持手动同步`);
      return null;
    }
    const tradeDay = normalizeDateText(syncForm.tradeDay);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDay)) {
      setSyncDialogError('请先选择有效交易日（YYYY-MM-DD）');
      return null;
    }
    if (hasSyncLookbackLimit && tradeDay < earliestSyncDay) {
      setSyncDialogError(`${syncRule.label} 最早仅支持同步到 ${earliestSyncDay}`);
      return null;
    }
    if (tradeDay > todayText) {
      setSyncDialogError('起始交易日不能晚于今天');
      return null;
    }

    const rangeMode = syncForm.syncRange === 'from_trade_day_to_now' ? 'from_trade_day_to_now' : 'single_day';
    const endDay = rangeMode === 'from_trade_day_to_now' ? todayText : tradeDay;
    const scopeText = filters.quoteCode
      ? `仅同步品种：${filters.quoteCode}`
      : (filters.symbolType === 'stock' ? '同步全部A股股票' : '同步全部已监测品种');
    const rangeText = rangeMode === 'single_day'
      ? `仅同步 ${tradeDay}`
      : `从 ${tradeDay} 同步到 ${todayText}`;

    setSyncForm((prev) => ({ ...prev, tradeDay }));
    setPendingSyncPlan({
      tradeDay,
      endDay,
      rangeMode,
      scopeText,
      rangeText,
    });
    setSyncConfirmMode(true);
    return {
      tradeDay,
      rangeMode,
    };
  }

  const normalizedTradeDay = normalizeDateText(syncForm.tradeDay);
  const isTradeDayInRange = Boolean(
    normalizedTradeDay
      && (!earliestSyncDay || normalizedTradeDay >= earliestSyncDay)
      && normalizedTradeDay <= todayText,
  );

  async function submitSync(plan) {
    if (!plan) {
      setSyncDialogError('同步计划为空，请重新点“下一步：确认同步”');
      setSyncConfirmMode(false);
      return;
    }

    setPendingSyncPlan(null);
    setSyncing(true);
    setSyncPhase('submitting');
    try {
      const result = await clientApi.system.syncMarketDataAll({
        symbolType: filters.symbolType,
        timeframe: filters.timeframe,
        tradeDay: plan.tradeDay,
        syncRange: plan.rangeMode,
        quoteCode: filters.quoteCode,
      });

      const failedSummary = (result.failed || [])
        .slice(0, 3)
        .map((item) => `${item.quoteCode}: ${item.message}`)
        .join(' | ');

      const displayTradeDay = plan.rangeMode === 'from_trade_day_to_now'
        ? (result.lastSyncedDay || result.endDay || '')
        : plan.tradeDay;

      const refreshedFilters = {
        ...filters,
        startDay: plan.tradeDay,
        endDay: displayTradeDay || plan.tradeDay,
      };
      setFilters(refreshedFilters);
      setSyncPhase('refreshing');
      await query({ nextPage: 1, nextFilters: refreshedFilters });
      await loadJobs({ silent: true });

      const rangeSummary = plan.rangeMode === 'from_trade_day_to_now'
        ? `同步区间 ${result.startDay} ~ ${result.endDay}`
        : `同步日期 ${result.startDay}`;
      const displaySummary = refreshedFilters.startDay && refreshedFilters.endDay
        ? (refreshedFilters.startDay === refreshedFilters.endDay
          ? `；当前展示交易日 ${refreshedFilters.startDay}`
          : `；当前展示范围 ${refreshedFilters.startDay} ~ ${refreshedFilters.endDay}`)
        : '';

      setMessage(
        `同步完成（${rangeSummary}）：成功 ${formatInt(result.successSymbols || 0)} / ${formatInt(result.symbolTotal || 0)}，` +
        `写入 ${formatInt(result.writtenBars || 0)} 条` +
        displaySummary +
        (Number(result.failedSymbols || 0) > 0
          ? `；失败 ${formatInt(result.failedSymbols || 0)}${failedSummary ? `（${failedSummary}）` : ''}`
          : ''),
      );
      setSyncConfirmMode(false);
      setSyncDialogOpen(false);
    } catch (error) {
      setMessage(`同步失败：${error.message || '未知错误'}`);
    } finally {
      setSyncPhase('idle');
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-border/70 bg-muted/30 p-1">
        <Button
          variant={activeTab === 'audit' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('audit')}
        >
          数据核查
        </Button>
        <Button
          variant={activeTab === 'jobs' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('jobs')}
        >
          同步任务
        </Button>
      </div>

      {activeTab === 'audit' ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>本地行情数据检查</CardTitle>
              <CardDescription>用于核对本地行情数据完整性和准确性（股票/期货）。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={filters.symbolType}
                  onValueChange={(value) => setFilters((prev) => ({ ...prev, symbolType: value }))}
                >
                  <SelectTrigger className="w-[120px] min-w-[120px]" style={{ width: '120px', minWidth: '120px' }}>
                    <SelectValue placeholder="标的类型" />
                  </SelectTrigger>
                  <SelectContent className="w-[120px] min-w-[120px]" style={{ width: '120px', minWidth: '120px' }}>
                    {SYMBOL_TYPE_OPTIONS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={filters.timeframe}
                  onValueChange={(value) => setFilters((prev) => ({ ...prev, timeframe: value }))}
                >
                  <SelectTrigger className="w-[120px] min-w-[120px]" style={{ width: '120px', minWidth: '120px' }}>
                    <SelectValue placeholder="粒度" />
                  </SelectTrigger>
                  <SelectContent
                    className="w-[120px] min-w-[120px]"
                    style={{ width: '120px', minWidth: '120px' }}
                  >
                    {TIMEFRAME_OPTIONS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="date"
                  value={filters.startDay}
                  onChange={(event) => setFilters((prev) => ({ ...prev, startDay: event.target.value }))}
                  className="w-[180px]"
                  title="开始日期"
                  aria-label="开始日期"
                />
                {filters.symbolType === 'stock' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFilters((prev) => ({ ...prev, startDay: CN_A_SHARE_EARLIEST_DAY }))}
                  >
                    A股最早
                  </Button>
                ) : null}
                <span className="text-sm text-muted-foreground">至</span>
                <Input
                  type="date"
                  value={filters.endDay}
                  onChange={(event) => setFilters((prev) => ({ ...prev, endDay: event.target.value }))}
                  className="w-[180px]"
                  title="结束日期"
                  aria-label="结束日期"
                />
                <Input
                  value={filters.quoteCode}
                  onChange={(event) => setFilters((prev) => ({ ...prev, quoteCode: event.target.value.toUpperCase() }))}
                  placeholder={filters.symbolType === 'stock' ? '股票代码，如 600519 / SH600519' : '品种代码，如 113.AU2604 / SI00Y'}
                  className="w-[260px]"
                />
                <Button onClick={() => query({ nextPage: 1, nextFilters: filters }).catch(() => {})} disabled={loading}>
                  查询
                </Button>
              </div>

              {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
              <p className="text-xs text-muted-foreground">
                {syncRule
                  ? (hasSyncLookbackLimit
                    ? `同步限制：${syncRule.label}粒度最早支持 ${earliestSyncDay}（避免过度加载历史数据）`
                    : `同步限制：当前粒度不限制历史起始日期（仅分钟粒度有限制）`)
                  : `当前模式 ${filters.symbolType === 'stock' ? '股票' : '期货'} 下，粒度 ${getTimeframeLabel(filters.timeframe)} 暂不支持手动同步`}
              </p>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                  <p className="text-xs text-muted-foreground">时间范围</p>
                  <p className="text-sm font-semibold">
                    {activeStartDay && activeEndDay
                      ? (activeStartDay === activeEndDay ? activeStartDay : `${activeStartDay} ~ ${activeEndDay}`)
                      : '--'}
                  </p>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                  <p className="text-xs text-muted-foreground">总行数</p>
                  <p className="text-sm font-semibold">{formatInt(payload?.summary?.totalBars || 0)}</p>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                  <p className="text-xs text-muted-foreground">估算缺口</p>
                  <p className="text-sm font-semibold">{formatInt(payload?.summary?.estimatedMissingBars || 0)}</p>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                  <p className="text-xs text-muted-foreground">完整率</p>
                  <p className="text-sm font-semibold">{formatPercent(payload?.summary?.completenessPct || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>品种完整性概览</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[260px] overflow-auto rounded-lg border border-border/60">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">品种代码</th>
                      <th className="px-3 py-2 text-left">品种名称</th>
                      <th className="px-3 py-2 text-left">K线数</th>
                      <th className="px-3 py-2 text-left">估算缺口</th>
                      <th className="px-3 py-2 text-left">完整率</th>
                      <th className="px-3 py-2 text-left">首条时间</th>
                      <th className="px-3 py-2 text-left">末条时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(payload?.symbols || []).map((item) => (
                      <tr key={item.quoteCode} className="border-t border-border/40">
                        <td className="px-3 py-2 font-mono">{item.quoteCode}</td>
                        <td className="px-3 py-2">{item.symbolName || '--'}</td>
                        <td className="px-3 py-2">{formatInt(item.bars)}</td>
                        <td className="px-3 py-2">{formatInt(item.estimatedMissingBars)}</td>
                        <td className="px-3 py-2">{formatPercent(item.completenessPct)}</td>
                        <td className="px-3 py-2">{item.firstDate || '--'}</td>
                        <td className="px-3 py-2">{item.lastDate || '--'}</td>
                      </tr>
                    ))}
                    {!payload?.symbols?.length ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">当前筛选条件下暂无数据</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>行情明细</CardTitle>
              <Button variant="outline" onClick={openSyncDialog} disabled={loading || syncing}>
                手动同步
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="max-h-[520px] overflow-auto rounded-lg border border-border/60">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">时间</th>
                      <th className="px-3 py-2 text-left">品种</th>
                      <th className="px-3 py-2 text-left">开</th>
                      <th className="px-3 py-2 text-left">高</th>
                      <th className="px-3 py-2 text-left">低</th>
                      <th className="px-3 py-2 text-left">收</th>
                      <th className="px-3 py-2 text-left">成交量</th>
                      <th className="px-3 py-2 text-left">成交额</th>
                      <th className="px-3 py-2 text-left">间隔</th>
                      <th className="px-3 py-2 text-left">缺口根数</th>
                      <th className="px-3 py-2 text-left">来源</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(payload?.items || []).map((item) => (
                      <tr key={`${item.quoteCode}-${item.bucketTs}`} className="border-t border-border/40">
                        <td className="px-3 py-2 font-mono">{item.date}</td>
                        <td className="px-3 py-2 font-mono">{item.quoteCode}</td>
                        <td className="px-3 py-2">{formatNumber(item.open)}</td>
                        <td className="px-3 py-2">{formatNumber(item.high)}</td>
                        <td className="px-3 py-2">{formatNumber(item.low)}</td>
                        <td className="px-3 py-2">{formatNumber(item.close)}</td>
                        <td className="px-3 py-2">{formatInt(item.volume)}</td>
                        <td className="px-3 py-2">{formatInt(item.amount)}</td>
                        <td className="px-3 py-2">{formatGap(item.gapSeconds)}</td>
                        <td className="px-3 py-2">{formatInt(item.gapBars)}</td>
                        <td className="px-3 py-2">{item.source || '--'}</td>
                      </tr>
                    ))}
                    {!payload?.items?.length ? (
                      <tr>
                        <td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">当前分页暂无数据</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  第 {pagination.page || 1} / {pagination.totalPages || 0} 页，共 {formatInt(pagination.total || 0)} 条
                </p>
                <div className="flex items-center gap-2">
                  <Select
                    value={String(filters.limit)}
                    onValueChange={(value) => {
                      const nextLimit = Number(value) || 200;
                      const nextFilters = { ...filters, limit: nextLimit };
                      setFilters(nextFilters);
                      query({ nextPage: 1, nextFilters }).catch(() => {});
                    }}
                  >
                    <SelectTrigger
                      className="w-[120px]"
                      style={{ width: '120px', minWidth: '120px' }}
                      disabled={loading || syncing}
                    >
                      <SelectValue placeholder="每页条数" />
                    </SelectTrigger>
                    <SelectContent style={{ width: '120px', minWidth: '120px' }}>
                      <SelectItem value="100">每页 100</SelectItem>
                      <SelectItem value="200">每页 200</SelectItem>
                      <SelectItem value="500">每页 500</SelectItem>
                      <SelectItem value="1000">每页 1000</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canPrev || loading}
                    onClick={() => query({ nextPage: page - 1 }).catch(() => {})}
                  >
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canNext || loading}
                    onClick={() => query({ nextPage: page + 1 }).catch(() => {})}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      {activeTab === 'jobs' ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>同步任务</CardTitle>
              <CardDescription>查看历史任务、当前执行进展和失败明细。</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={String(jobsAutoRefreshMs)}
                onValueChange={(value) => {
                  const nextMs = Number(value) || 30000;
                  const allowed = JOBS_AUTO_REFRESH_OPTIONS.some((item) => item.value === nextMs);
                  setJobsAutoRefreshMs(allowed ? nextMs : 30000);
                }}
              >
                <SelectTrigger className="w-[132px]" style={{ width: '132px', minWidth: '132px' }}>
                  <SelectValue placeholder="自动刷新" />
                </SelectTrigger>
                <SelectContent style={{ width: '132px', minWidth: '132px' }}>
                  {JOBS_AUTO_REFRESH_OPTIONS.map((item) => (
                    <SelectItem key={item.value} value={String(item.value)}>
                      自动刷新 {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => loadJobs().catch(() => {})} disabled={jobsLoading}>
                刷新任务
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {jobsMessage ? <p className="text-xs text-muted-foreground">{jobsMessage}</p> : null}
            <div className="rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">任务ID</th>
                    <th className="px-3 py-2 text-left">类型</th>
                    <th className="px-3 py-2 text-left">标的</th>
                    <th className="px-3 py-2 text-left">粒度</th>
                    <th className="px-3 py-2 text-left">范围</th>
                    <th className="px-3 py-2 text-left">状态</th>
                    <th className="px-3 py-2 text-left">进度</th>
                    <th className="px-3 py-2 text-left">创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {(jobsPayload?.items || []).map((job) => {
                    const pct = Number(job?.progress?.progressPct || 0);
                    const done = Number(job?.progress?.doneItems || 0);
                    const total = Number(job?.progress?.totalItems || 0);
                    const statusRaw = String(job?.status || '--');
                    const statusText = getSyncJobStatusLabel(statusRaw);
                    const statusClass = statusRaw === 'success'
                      ? 'text-green-600'
                      : statusRaw.includes('fail')
                        ? 'text-red-600'
                        : statusRaw === 'running'
                          ? 'text-blue-600'
                          : 'text-muted-foreground';
                    return (
                      <tr key={job.id} className="border-t border-border/40 align-top">
                        <td className="px-3 py-2 font-mono">{job.id}</td>
                        <td className="px-3 py-2">{getSyncJobTypeLabel(job.jobType)}</td>
                        <td className="px-3 py-2">{getSyncJobSymbolTypeLabel(job.symbolType)}</td>
                        <td className="px-3 py-2">{getTimeframeLabel(job.timeframe)}</td>
                        <td className="px-3 py-2">{job.startDate && job.endDate ? `${job.startDate} ~ ${job.endDate}` : '--'}</td>
                        <td className={`px-3 py-2 font-medium ${statusClass}`}>{statusText}</td>
                        <td className="px-3 py-2 min-w-[220px]">
                          <div className="space-y-1">
                            <div className="h-2 w-full overflow-hidden rounded bg-muted">
                              <div className="h-full bg-primary" style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }} />
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {done}/{total} 完成，成功 {formatInt(job?.progress?.successItems || 0)}，失败 {formatInt(job?.progress?.failedItems || 0)}
                            </p>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs">{job.createdAt || '--'}</td>
                      </tr>
                    );
                  })}
                  {!jobsPayload?.items?.length ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">暂无同步任务</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                第 {jobsPagination.page || 1} / {jobsPagination.totalPages || 0} 页，共 {formatInt(jobsPagination.total || 0)} 条
              </p>
              <div className="flex items-center gap-2">
                <Select
                  value={String(jobsLimit)}
                  onValueChange={(value) => {
                    const nextLimit = Number(value) || 20;
                    setJobsLimit(nextLimit);
                    loadJobs({ nextPage: 1, nextLimit }).catch(() => {});
                  }}
                >
                  <SelectTrigger
                    className="w-[120px]"
                    style={{ width: '120px', minWidth: '120px' }}
                    disabled={jobsLoading}
                  >
                    <SelectValue placeholder="每页条数" />
                  </SelectTrigger>
                  <SelectContent style={{ width: '120px', minWidth: '120px' }}>
                    <SelectItem value="10">每页 10</SelectItem>
                    <SelectItem value="20">每页 20</SelectItem>
                    <SelectItem value="50">每页 50</SelectItem>
                    <SelectItem value="100">每页 100</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!jobsCanPrev || jobsLoading}
                  onClick={() => loadJobs({ nextPage: jobsPage - 1, nextLimit: jobsLimit }).catch(() => {})}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!jobsCanNext || jobsLoading}
                  onClick={() => loadJobs({ nextPage: jobsPage + 1, nextLimit: jobsLimit }).catch(() => {})}
                >
                  下一页
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>操作提示</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
            <p>已拆分为两个页签：</p>
            <p>数据核查：用于筛选、明细查看、手动同步发起。</p>
            <p>同步任务：用于查看实时进展和历史记录。</p>
          </div>
        </CardContent>
      </Card>

      {syncDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={closeSyncDialog}>
          <div
            className="w-[min(92vw,760px)] rounded-2xl border border-border/70 bg-background shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
              <h3 className="text-lg font-semibold">手动同步行情数据</h3>
              <Button type="button" variant="ghost" size="sm" onClick={closeSyncDialog} disabled={syncing}>
                关闭
              </Button>
            </div>

            <div className="space-y-4 p-5">
              {syncing ? (
                <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                  <span>{syncPhase === 'refreshing' ? '同步成功，正在刷新列表数据...' : '正在执行同步，请稍候...'}</span>
                </div>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                  <p className="text-xs text-muted-foreground">当前粒度</p>
                  <p className="text-sm font-semibold">{syncRule?.label || getTimeframeLabel(filters.timeframe)}</p>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                  <p className="text-xs text-muted-foreground">同步品种范围</p>
                  <p className="text-sm font-semibold">{filters.quoteCode || (filters.symbolType === 'stock' ? '全部A股股票' : '全部已监测品种')}</p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">同步时间范围</p>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="radio"
                    name="sync-range"
                    checked={syncForm.syncRange === 'single_day'}
                    onChange={() => {
                      setSyncDialogError('');
                      setSyncConfirmMode(false);
                      setPendingSyncPlan(null);
                      setSyncForm((prev) => ({ ...prev, syncRange: 'single_day' }));
                    }}
                    disabled={syncing}
                  />
                  仅同步选定交易日
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="radio"
                    name="sync-range"
                    checked={syncForm.syncRange === 'from_trade_day_to_now'}
                    onChange={() => {
                      setSyncDialogError('');
                      setSyncConfirmMode(false);
                      setPendingSyncPlan(null);
                      setSyncForm((prev) => ({ ...prev, syncRange: 'from_trade_day_to_now' }));
                    }}
                    disabled={syncing}
                  />
                  从选定交易日同步到今天
                </label>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">起始交易日</p>
                <Input
                  type="date"
                  value={syncForm.tradeDay}
                  onChange={(event) => {
                    setSyncDialogError('');
                    setSyncConfirmMode(false);
                    setPendingSyncPlan(null);
                    setSyncForm((prev) => ({ ...prev, tradeDay: normalizeDateText(event.target.value) }));
                  }}
                  min={hasSyncLookbackLimit ? earliestSyncDay : undefined}
                  max={todayText}
                  disabled={syncing}
                  className={isTradeDayInRange ? '' : 'border-destructive/70 focus-visible:ring-destructive/40'}
                />
                {filters.symbolType === 'stock' ? (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSyncDialogError('');
                        setSyncConfirmMode(false);
                        setPendingSyncPlan(null);
                        setSyncForm((prev) => ({ ...prev, tradeDay: CN_A_SHARE_EARLIEST_DAY }));
                      }}
                      disabled={syncing}
                    >
                      A股最早日期
                    </Button>
                    <span className="text-xs text-muted-foreground">{CN_A_SHARE_EARLIEST_DAY}</span>
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {hasSyncLookbackLimit
                    ? `当前粒度最早可同步：${earliestSyncDay || '--'}；今天：${todayText}`
                    : `当前粒度可同步任意历史日期；今天：${todayText}`}
                </p>
                {hasSyncLookbackLimit && !isTradeDayInRange ? (
                  <p className="text-xs text-destructive">请选择 {earliestSyncDay} 到 {todayText} 之间的交易日</p>
                ) : null}
                {syncDialogError ? (
                  <p className="text-xs text-destructive">{syncDialogError}</p>
                ) : null}
              </div>

              {syncConfirmMode && pendingSyncPlan ? (
                <div className="space-y-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-3 text-sm">
                  <p className="font-medium text-primary">请确认同步范围</p>
                  <p><span className="text-muted-foreground">粒度：</span>{syncRule?.label || getTimeframeLabel(filters.timeframe)}</p>
                  <p><span className="text-muted-foreground">时间范围：</span>{pendingSyncPlan.rangeText}</p>
                  <p><span className="text-muted-foreground">同步范围：</span>{pendingSyncPlan.scopeText}</p>
                  <p>
                    <span className="text-muted-foreground">最早可同步日期：</span>
                    {hasSyncLookbackLimit ? earliestSyncDay : '不限制（仅分钟粒度限制）'}
                  </p>
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-4">
              {syncConfirmMode ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (syncing) return;
                      setSyncConfirmMode(false);
                    }}
                    disabled={syncing}
                  >
                    返回修改
                  </Button>
                  <Button
                    onClick={() => {
                      if (syncing || !pendingSyncPlan) return;
                      submitSync(pendingSyncPlan).catch(() => {});
                    }}
                    disabled={syncing || !pendingSyncPlan}
                  >
                    {syncing ? '同步中...' : '确认并开始同步'}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={closeSyncDialog} disabled={syncing}>
                    取消
                  </Button>
                  <Button onClick={openSyncConfirm} disabled={syncing || !syncRule || !isTradeDayInRange}>
                    下一步：确认同步
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

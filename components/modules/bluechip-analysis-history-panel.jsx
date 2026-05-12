'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { clientApi } from '@/lib/client-api';

const SIGNAL_LABEL = {
  index_linked_start_buy: '指数联动起涨买点',
  stock_independent_start_buy: '个股独立起涨买点',
  stop_loss: '止损卖点',
  take_profit: '止盈卖点',
  break_medium: '跌破中阳',
  lose_long_half: '跌破长阳半体',
  fail_prev_high: '不过前高',
};

const MODE_OPTIONS = [
  { value: '__all__', label: '全部模式' },
  { value: 'today', label: '今日分析' },
  { value: 'history', label: '历史分析' },
];

const DEFAULT_FILTERS = {
  analysisMode: '__all__',
  dateFrom: '',
  dateTo: '',
  poolCode: '',
  batchId: '',
  keyword: '',
};

function buildQuery(filters, page, pageSize) {
  const query = {
    page,
    pageSize,
  };
  if (filters.analysisMode && filters.analysisMode !== '__all__') query.analysisMode = filters.analysisMode;
  if (filters.dateFrom) query.dateFrom = filters.dateFrom;
  if (filters.dateTo) query.dateTo = filters.dateTo;
  if (filters.poolCode) query.poolCode = String(filters.poolCode || '').trim().toUpperCase();
  if (filters.batchId) query.batchId = String(filters.batchId || '').trim();
  if (filters.keyword) query.keyword = String(filters.keyword || '').trim();
  return query;
}

function calcTotalPages(total, pageSize) {
  return Math.max(1, Math.ceil((Number(total) || 0) / Math.max(1, Number(pageSize) || 1)));
}

export function BluechipAnalysisHistoryPanel() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [signalPage, setSignalPage] = useState(1);
  const [signalPageSize] = useState(100);
  const [signalsData, setSignalsData] = useState({ items: [], total: 0, page: 1, pageSize: 100 });

  const [batchPage, setBatchPage] = useState(1);
  const [batchPageSize] = useState(30);
  const [batchesData, setBatchesData] = useState({ items: [], total: 0, page: 1, pageSize: 30 });

  const signalTotalPages = useMemo(
    () => calcTotalPages(signalsData?.total, signalsData?.pageSize),
    [signalsData?.total, signalsData?.pageSize],
  );

  const batchTotalPages = useMemo(
    () => calcTotalPages(batchesData?.total, batchesData?.pageSize),
    [batchesData?.total, batchesData?.pageSize],
  );

  async function queryData(nextSignalPage = signalPage, nextBatchPage = batchPage, overrideFilters = null) {
    const activeFilters = overrideFilters || filters;
    setLoading(true);
    setMessage('');
    try {
      const [signalsPayload, batchesPayload] = await Promise.all([
        clientApi.strategy.bluechipSavedSignals(buildQuery(activeFilters, nextSignalPage, signalPageSize)),
        clientApi.strategy.bluechipSavedBatches(buildQuery(activeFilters, nextBatchPage, batchPageSize)),
      ]);
      setSignalsData({
        items: Array.isArray(signalsPayload?.items) ? signalsPayload.items : [],
        total: Number(signalsPayload?.total || 0),
        page: Number(signalsPayload?.page || nextSignalPage),
        pageSize: Number(signalsPayload?.pageSize || signalPageSize),
      });
      setBatchesData({
        items: Array.isArray(batchesPayload?.items) ? batchesPayload.items : [],
        total: Number(batchesPayload?.total || 0),
        page: Number(batchesPayload?.page || nextBatchPage),
        pageSize: Number(batchesPayload?.pageSize || batchPageSize),
      });
      setSignalPage(nextSignalPage);
      setBatchPage(nextBatchPage);
      setMessage(`查询完成：批次 ${Number(batchesPayload?.total || 0)}，信号 ${Number(signalsPayload?.total || 0)}`);
    } catch (error) {
      setMessage(`查询失败：${error.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    queryData(1, 1).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>蓝筹分析记录</CardTitle>
          <CardDescription>查询已保存的蓝筹模式信号结果，支持按批次回看。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-6">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">模式</label>
              <Select value={filters.analysisMode} onValueChange={(value) => setFilters((prev) => ({ ...prev, analysisMode: value }))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="全部模式" />
                </SelectTrigger>
                <SelectContent>
                  {MODE_OPTIONS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">开始日期</label>
              <Input
                type="date"
                value={filters.dateFrom}
                onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">结束日期</label>
              <Input
                type="date"
                value={filters.dateTo}
                onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">标的池代码</label>
              <Input
                value={filters.poolCode}
                onChange={(event) => setFilters((prev) => ({ ...prev, poolCode: event.target.value.toUpperCase() }))}
                placeholder="例如 TOP500_26"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">批次ID</label>
              <Input
                value={filters.batchId}
                onChange={(event) => setFilters((prev) => ({ ...prev, batchId: event.target.value }))}
                placeholder="例如 BC_20260512_XXXX"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">关键词</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  value={filters.keyword}
                  onChange={(event) => setFilters((prev) => ({ ...prev, keyword: event.target.value }))}
                  className="pl-9"
                  placeholder="代码/名称/类型/原因"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => queryData(1, 1).catch(() => {})} disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : null}
              查询
            </Button>
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => {
                const cleared = { ...DEFAULT_FILTERS };
                setFilters(cleared);
                queryData(1, 1, cleared).catch(() => {});
              }}
            >
              重置
            </Button>
            {message ? <span className="text-sm text-muted-foreground">{message}</span> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>批次列表</CardTitle>
          <CardDescription>共 {batchesData.total || 0} 个批次，点击“查看信号”可筛选对应结果。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-h-[280px] overflow-auto rounded-lg border border-border/70">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background text-xs text-muted-foreground shadow-[inset_0_-1px_0_hsl(var(--border))]">
                <tr>
                  <th className="px-3 py-2 text-left">批次ID</th>
                  <th className="px-3 py-2 text-left">分析日期</th>
                  <th className="px-3 py-2 text-left">模式</th>
                  <th className="px-3 py-2 text-left">标的池</th>
                  <th className="px-3 py-2 text-right">信号数</th>
                  <th className="px-3 py-2 text-right">股票数</th>
                  <th className="px-3 py-2 text-left">操作</th>
                </tr>
              </thead>
              <tbody>
                {!batchesData.items.length ? (
                  <tr>
                    <td className="px-3 py-4 text-center text-muted-foreground" colSpan={7}>暂无数据</td>
                  </tr>
                ) : null}
                {batchesData.items.map((item) => (
                  <tr key={item.batchId} className="border-t border-border/60">
                    <td className="px-3 py-2 font-mono text-xs">{item.batchId}</td>
                    <td className="px-3 py-2">{item.analysisDate || '--'}</td>
                    <td className="px-3 py-2">{item.analysisMode === 'today' ? '今日分析' : '历史分析'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {item.poolName ? `${item.poolName}（${item.poolCode || '--'}）` : (item.poolCode || '--')}
                    </td>
                    <td className="px-3 py-2 text-right">{item.signalCount || 0}</td>
                    <td className="px-3 py-2 text-right">{item.stockCount || 0}</td>
                    <td className="px-3 py-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const nextFilters = { ...filters, batchId: item.batchId };
                          setFilters(nextFilters);
                          queryData(1, 1, nextFilters).catch(() => {});
                        }}
                      >
                        查看信号
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={loading || batchPage <= 1}
              onClick={() => queryData(signalPage, batchPage - 1).catch(() => {})}
            >上一页</Button>
            <span className="text-xs text-muted-foreground">{batchPage} / {batchTotalPages}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={loading || batchPage >= batchTotalPages}
              onClick={() => queryData(signalPage, batchPage + 1).catch(() => {})}
            >下一页</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>信号列表</CardTitle>
          <CardDescription>共 {signalsData.total || 0} 条信号记录。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-h-[520px] overflow-auto rounded-lg border border-border/70">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background text-xs text-muted-foreground shadow-[inset_0_-1px_0_hsl(var(--border))]">
                <tr>
                  <th className="px-3 py-2 text-left">分析日期</th>
                  <th className="px-3 py-2 text-left">信号日期</th>
                  <th className="px-3 py-2 text-left">代码</th>
                  <th className="px-3 py-2 text-left">名称</th>
                  <th className="px-3 py-2 text-left">方向</th>
                  <th className="px-3 py-2 text-left">类型</th>
                  <th className="px-3 py-2 text-right">价格</th>
                  <th className="px-3 py-2 text-left">原因</th>
                  <th className="px-3 py-2 text-left">批次ID</th>
                </tr>
              </thead>
              <tbody>
                {!signalsData.items.length ? (
                  <tr>
                    <td className="px-3 py-4 text-center text-muted-foreground" colSpan={9}>暂无数据</td>
                  </tr>
                ) : null}
                {signalsData.items.map((item) => (
                  <tr key={item.id} className="border-t border-border/60">
                    <td className="px-3 py-2">{item.analysisDate || '--'}</td>
                    <td className="px-3 py-2">{item.signalDate || '--'}</td>
                    <td className="px-3 py-2 font-medium">{item.stockCode || '--'}</td>
                    <td className="px-3 py-2">{item.stockName || '--'}</td>
                    <td className={`px-3 py-2 font-semibold ${item.signalSide === 'buy' ? 'text-emerald-600' : 'text-red-600'}`}>
                      {item.signalSide === 'buy' ? '买点' : '卖点'}
                    </td>
                    <td className="px-3 py-2">{SIGNAL_LABEL[item.signalType] || item.signalType || '--'}</td>
                    <td className="px-3 py-2 text-right">{Number.isFinite(Number(item.signalPrice)) ? Number(item.signalPrice).toFixed(2) : '--'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{item.signalReason || '--'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{item.batchId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={loading || signalPage <= 1}
              onClick={() => queryData(signalPage - 1, batchPage).catch(() => {})}
            >上一页</Button>
            <span className="text-xs text-muted-foreground">{signalPage} / {signalTotalPages}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={loading || signalPage >= signalTotalPages}
              onClick={() => queryData(signalPage + 1, batchPage).catch(() => {})}
            >下一页</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

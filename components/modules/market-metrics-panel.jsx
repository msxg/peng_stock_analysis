'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { clientApi } from '@/lib/client-api';
import { MetricTrendChart } from '@/components/charts/metric-trend-chart';

const PRICE_MODE_OPTIONS = [
  { value: 'close_raw', label: '不复权收盘价 (close_raw)' },
  { value: 'close_qfq', label: '前复权收盘价 (close_qfq)' },
  { value: 'close_hfq', label: '后复权收盘价 (close_hfq)' },
];
const PRICE_MODE_LABEL_MAP = Object.fromEntries(
  PRICE_MODE_OPTIONS.map((item) => [item.value, item.label]),
);
const SCOPE_KEY_LABEL_MAP = {
  ALL_A: '全A（ALL_A）',
};
const COMPUTE_RANGE_CHUNK_DAYS = 20;

function formatDateInput(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function oneMonthAgoInput(baseDate = new Date()) {
  const d = baseDate instanceof Date ? new Date(baseDate) : new Date(baseDate);
  d.setMonth(d.getMonth() - 1);
  return formatDateInput(d);
}

function boolText(value) {
  return value ? '是' : '否';
}

function formatNumber(value, digits = 4) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toFixed(digits);
}

function toNonNegativeInt(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.floor(num));
}

function toPositiveInt(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.floor(num));
}

function formatDateTime(value) {
  const text = String(value || '').trim();
  if (!text) return '--';
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return text;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function normalizeRulePayload(input = {}) {
  return {
    ruleKey: String(input.ruleKey || '').trim().toUpperCase(),
    name: String(input.name || '').trim(),
    scopeKey: 'ALL_A',
    priceMode: String(input.priceMode || 'close_raw').trim().toLowerCase(),
    excludeSuspended: String(input.excludeSuspended || 'true') === 'true',
    minListingTradingDays: toNonNegativeInt(input.minListingTradingDays, 0),
    includeSt: String(input.includeSt || 'true') === 'true',
    minSampleSize: toPositiveInt(input.minSampleSize, 1),
    isEnabled: String(input.isEnabled || 'true') === 'true',
    isDefault: String(input.isDefault || 'false') === 'true',
  };
}

function parseDateInput(value = '') {
  const text = String(value || '').trim();
  if (!text) return null;
  const d = new Date(`${text}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function buildDateChunks(startDay = '', endDay = '', chunkDays = COMPUTE_RANGE_CHUNK_DAYS) {
  const start = parseDateInput(startDay);
  const end = parseDateInput(endDay);
  if (!start || !end || start > end) return [];
  const chunks = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const chunkStart = formatDateInput(cursor);
    const chunkEndDate = new Date(cursor);
    chunkEndDate.setDate(chunkEndDate.getDate() + Math.max(1, chunkDays) - 1);
    if (chunkEndDate > end) chunkEndDate.setTime(end.getTime());
    const chunkEnd = formatDateInput(chunkEndDate);
    chunks.push({
      startDay: chunkStart,
      endDay: chunkEnd,
    });
    cursor = new Date(chunkEndDate);
    cursor.setDate(cursor.getDate() + 1);
  }
  return chunks;
}

function mergeComputePayload(base = null, incoming = {}, requestedStart = '', requestedEnd = '') {
  if (!base) {
    return {
      ...incoming,
      startDay: requestedStart || incoming.startDay || null,
      endDay: requestedEnd || incoming.endDay || null,
      mode: (requestedStart && requestedEnd && requestedStart !== requestedEnd) ? 'range' : (incoming.mode || 'single'),
      daySummaries: Array.isArray(incoming.daySummaries) ? [...incoming.daySummaries] : [],
      items: Array.isArray(incoming.items) ? [...incoming.items] : [],
      errors: Array.isArray(incoming.errors) ? [...incoming.errors] : [],
    };
  }

  return {
    ...base,
    mode: 'range',
    startDay: base.startDay || requestedStart || incoming.startDay || null,
    endDay: requestedEnd || incoming.endDay || base.endDay || null,
    totalTradeDays: Number(base.totalTradeDays || 0) + Number(incoming.totalTradeDays || 0),
    totalRules: Number(base.totalRules || 0) + Number(incoming.totalRules || 0),
    success: Number(base.success || 0) + Number(incoming.success || 0),
    failed: Number(base.failed || 0) + Number(incoming.failed || 0),
    skipped: Number(base.skipped || 0) + Number(incoming.skipped || 0),
    items: [...(base.items || []), ...(Array.isArray(incoming.items) ? incoming.items : [])],
    errors: [...(base.errors || []), ...(Array.isArray(incoming.errors) ? incoming.errors : [])],
    daySummaries: [...(base.daySummaries || []), ...(Array.isArray(incoming.daySummaries) ? incoming.daySummaries : [])],
  };
}

export function MarketMetricsPanel() {
  const today = useMemo(() => formatDateInput(new Date()), []);
  const oneMonthAgo = useMemo(() => oneMonthAgoInput(new Date()), []);
  const [rules, setRules] = useState([]);
  const [activeRuleId, setActiveRuleId] = useState('');
  const [message, setMessage] = useState('');
  const [loadingRules, setLoadingRules] = useState(false);
  const [submittingRule, setSubmittingRule] = useState(false);

  const [ruleForm, setRuleForm] = useState({
    ruleKey: 'ALL_A_CLOSE_RAW_V1',
    name: '全A不复权收盘价V1',
    priceMode: 'close_raw',
    excludeSuspended: 'true',
    minListingTradingDays: '0',
    includeSt: 'true',
    minSampleSize: '1',
    isEnabled: 'true',
    isDefault: 'true',
  });

  const [computeForm, setComputeForm] = useState({
    startDay: today,
    endDay: today,
    ruleKey: '',
    force: 'false',
  });
  const [computing, setComputing] = useState(false);
  const [computeResult, setComputeResult] = useState(null);

  const [queryForm, setQueryForm] = useState({
    startDay: oneMonthAgo,
    endDay: today,
    ruleKey: '',
    limit: '200',
  });
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryResult, setQueryResult] = useState(null);
  const [showTrend, setShowTrend] = useState(false);
  const [trendNotice, setTrendNotice] = useState('');

  async function loadRules({ silent = false } = {}) {
    if (!silent) {
      setLoadingRules(true);
      setMessage('');
    }
    try {
      const payload = await clientApi.marketMetrics.listRules({});
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setRules(items);
      if (!activeRuleId && items[0]?.id) {
        setActiveRuleId(String(items[0].id));
      }
    } catch (error) {
      if (!silent) setMessage(`规则加载失败：${error.message || '未知错误'}`);
    } finally {
      if (!silent) setLoadingRules(false);
    }
  }

  useEffect(() => {
    loadRules({ silent: true }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeRule = useMemo(
    () => rules.find((item) => String(item.id) === String(activeRuleId)) || null,
    [activeRuleId, rules],
  );
  const defaultRule = useMemo(
    () => rules.find((item) => item.isDefault) || null,
    [rules],
  );

  useEffect(() => {
    if (!rules.length) return;
    setQueryForm((prev) => {
      const current = String(prev.ruleKey || '').trim().toUpperCase();
      const exists = current && rules.some((item) => item.ruleKey === current);
      if (exists) return prev;
      const nextRuleKey = defaultRule?.ruleKey || '';
      if (nextRuleKey === prev.ruleKey) return prev;
      return {
        ...prev,
        ruleKey: nextRuleKey,
      };
    });
  }, [rules, defaultRule]);

  useEffect(() => {
    if (!rules.length) return;
    setComputeForm((prev) => {
      const current = String(prev.ruleKey || '').trim().toUpperCase();
      const exists = current && rules.some((item) => item.ruleKey === current);
      if (exists) return prev;
      const nextRuleKey = defaultRule?.ruleKey || '';
      if (nextRuleKey === prev.ruleKey) return prev;
      return {
        ...prev,
        ruleKey: nextRuleKey,
      };
    });
  }, [rules, defaultRule]);

  async function submitCreateRule() {
    setSubmittingRule(true);
    setMessage('');
    try {
      const payload = normalizeRulePayload(ruleForm);
      await clientApi.marketMetrics.createRule(payload);
      await loadRules({ silent: true });
      setMessage(`规则已创建：${payload.ruleKey}`);
    } catch (error) {
      setMessage(`规则创建失败：${error.message || '未知错误'}`);
    } finally {
      setSubmittingRule(false);
    }
  }

  async function submitUpdateRule() {
    if (!activeRule) {
      setMessage('请先从列表中选择一条规则');
      return;
    }
    setSubmittingRule(true);
    setMessage('');
    try {
      const payload = normalizeRulePayload(ruleForm);
      await clientApi.marketMetrics.updateRule(activeRule.id, payload);
      await loadRules({ silent: true });
      setMessage(`规则已更新：${payload.ruleKey}`);
    } catch (error) {
      setMessage(`规则更新失败：${error.message || '未知错误'}`);
    } finally {
      setSubmittingRule(false);
    }
  }

  function fillFormByRule(rule) {
    if (!rule) return;
    setRuleForm({
      ruleKey: rule.ruleKey || '',
      name: rule.name || '',
      priceMode: rule.priceMode || 'close_raw',
      excludeSuspended: rule.excludeSuspended ? 'true' : 'false',
      minListingTradingDays: String(rule.minListingTradingDays ?? 0),
      includeSt: rule.includeSt ? 'true' : 'false',
      minSampleSize: String(rule.minSampleSize ?? 1),
      isEnabled: rule.isEnabled ? 'true' : 'false',
      isDefault: rule.isDefault ? 'true' : 'false',
    });
  }

  async function submitCompute() {
    setComputing(true);
    setMessage('');
    setComputeResult(null);
    try {
      const startDay = String(computeForm.startDay || '').trim();
      const endDay = String(computeForm.endDay || '').trim();
      const chunks = buildDateChunks(startDay, endDay, COMPUTE_RANGE_CHUNK_DAYS);
      if (!chunks.length) {
        throw new Error('日期范围非法，请检查开始/结束日期');
      }

      let merged = null;
      for (let idx = 0; idx < chunks.length; idx += 1) {
        const chunk = chunks[idx];
        if (chunks.length > 1) {
          setMessage(`分段计算中：第 ${idx + 1}/${chunks.length} 段（${chunk.startDay} ~ ${chunk.endDay}）`);
        }
        const payload = await clientApi.marketMetrics.compute({
          startDay: chunk.startDay,
          endDay: chunk.endDay,
          ruleKey: String(computeForm.ruleKey || '').trim().toUpperCase(),
          force: computeForm.force === 'true',
        });
        merged = mergeComputePayload(merged, payload, startDay, endDay);
      }

      const finalPayload = merged || {};
      setComputeResult(finalPayload);
      setMessage(`计算完成：成功 ${finalPayload?.success || 0}，失败 ${finalPayload?.failed || 0}`);
      await loadRules({ silent: true });
    } catch (error) {
      setMessage(`指标计算失败：${error.message || '未知错误'}`);
    } finally {
      setComputing(false);
    }
  }

  async function queryRange() {
    setQueryLoading(true);
    setMessage('');
    setTrendNotice('');
    setQueryResult(null);
    setShowTrend(false);
    try {
      const payload = await clientApi.marketMetrics.dailyRange({
        startDay: String(queryForm.startDay || '').trim(),
        endDay: String(queryForm.endDay || '').trim(),
        scopeKey: 'ALL_A',
        ruleKey: String(queryForm.ruleKey || '').trim().toUpperCase(),
        limit: toPositiveInt(queryForm.limit, 200),
      });
      setQueryResult(payload);
      setMessage(`区间查询完成：${payload?.total || 0} 条`);
    } catch (error) {
      setMessage(`区间查询失败：${error.message || '未知错误'}`);
    } finally {
      setQueryLoading(false);
    }
  }

  const queryTrendData = useMemo(() => {
    const items = Array.isArray(queryResult?.items) ? queryResult.items : [];
    if (!items.length) return [];
    return items
      .map((item) => ({
        time: String(item.tradeDay || '').trim(),
        avgPrice: Number(item.avgPrice),
        medianPrice: Number(item.medianPrice),
      }))
      .filter((item) => item.time && Number.isFinite(item.avgPrice) && item.avgPrice > 0)
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [queryResult]);

  function handleShowTrend() {
    if (queryTrendData.length < 10) {
      setShowTrend(false);
      setTrendNotice(`折线图至少需要 10 天数据，当前仅 ${queryTrendData.length} 天`);
      return;
    }
    setTrendNotice('');
    setShowTrend((prev) => !prev);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>规则管理</CardTitle>
          <CardDescription>管理 A 股平均/中位数指标计算规则（V1 默认范围 ALL_A）。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-border/60 p-3">
              <p className="mb-2 text-sm font-medium">现有规则</p>
              <div className="max-h-56 overflow-auto rounded border border-border/50">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-left">规则标识</th>
                      <th className="px-2 py-1 text-left">默认</th>
                      <th className="px-2 py-1 text-left">启用状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((item) => (
                      <tr
                        key={item.id}
                        className={`cursor-pointer border-t border-border/40 ${String(item.id) === String(activeRuleId) ? 'bg-muted/50' : ''}`}
                        onClick={() => {
                          setActiveRuleId(String(item.id));
                          fillFormByRule(item);
                        }}
                      >
                        <td className="px-2 py-1 font-mono">{item.ruleKey}</td>
                        <td className="px-2 py-1">{item.isDefault ? '是' : '否'}</td>
                        <td className="px-2 py-1">{item.isEnabled ? '启用' : '停用'}</td>
                      </tr>
                    ))}
                    {!rules.length ? (
                      <tr>
                        <td colSpan={3} className="px-2 py-4 text-center text-muted-foreground">暂无规则</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">已加载：{rules.length} 条</div>
              <div className="mt-2">
                <Button size="sm" variant="secondary" onClick={() => loadRules().catch(() => {})} disabled={loadingRules}>
                  刷新规则
                </Button>
              </div>
            </div>

            <div className="rounded-md border border-border/60 p-3">
              <p className="mb-2 text-sm font-medium">规则编辑</p>
              <div className="grid gap-2">
                <Input
                  value={ruleForm.ruleKey}
                  placeholder="规则标识（英文），如 ALL_A_CLOSE_RAW_V1"
                  onChange={(e) => setRuleForm((prev) => ({ ...prev, ruleKey: e.target.value }))}
                />
                <Input
                  value={ruleForm.name}
                  placeholder="规则名称"
                  onChange={(e) => setRuleForm((prev) => ({ ...prev, name: e.target.value }))}
                />
                <select
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  value={ruleForm.priceMode}
                  onChange={(e) => setRuleForm((prev) => ({ ...prev, priceMode: e.target.value }))}
                >
                  {PRICE_MODE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>停牌剔除</span>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
                      value={ruleForm.excludeSuspended}
                      onChange={(e) => setRuleForm((prev) => ({ ...prev, excludeSuspended: e.target.value }))}
                    >
                      <option value="true">是</option>
                      <option value="false">否</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>包含 ST</span>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
                      value={ruleForm.includeSt}
                      onChange={(e) => setRuleForm((prev) => ({ ...prev, includeSt: e.target.value }))}
                    >
                      <option value="true">是</option>
                      <option value="false">否</option>
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>新股剔除阈值（交易日）</span>
                    <Input
                      value={ruleForm.minListingTradingDays}
                      placeholder="例如 0 或 60"
                      onChange={(e) => setRuleForm((prev) => ({ ...prev, minListingTradingDays: e.target.value }))}
                    />
                    <span className="block text-[11px]">0 表示不剔除；60 表示剔除上市未满 60 个交易日新股</span>
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>最小有效样本数</span>
                    <Input
                      value={ruleForm.minSampleSize}
                      placeholder="至少保留的样本数量"
                      onChange={(e) => setRuleForm((prev) => ({ ...prev, minSampleSize: e.target.value }))}
                    />
                    <span className="block text-[11px]">过滤后样本数低于该值时，本次规则计算记为失败</span>
                  </label>
                </div>
                <label className="space-y-1 text-xs text-muted-foreground">
                  <span>规则启用</span>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
                    value={ruleForm.isEnabled}
                    onChange={(e) => setRuleForm((prev) => ({ ...prev, isEnabled: e.target.value }))}
                  >
                    <option value="true">启用</option>
                    <option value="false">停用</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs text-muted-foreground">
                  <span>设为默认规则（同范围仅一条）</span>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
                    value={ruleForm.isDefault}
                    onChange={(e) => setRuleForm((prev) => ({ ...prev, isDefault: e.target.value }))}
                  >
                    <option value="false">否</option>
                    <option value="true">是</option>
                  </select>
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => submitCreateRule().catch(() => {})} disabled={submittingRule}>
                    新建规则
                  </Button>
                  <Button variant="secondary" onClick={() => submitUpdateRule().catch(() => {})} disabled={submittingRule}>
                    更新当前规则
                  </Button>
                </div>
                {activeRule ? (
                  <p className="text-xs text-muted-foreground">
                    当前选中：{activeRule.ruleKey} ｜ 默认：{boolText(activeRule.isDefault)} ｜ 启用：{boolText(activeRule.isEnabled)} ｜ 停牌剔除：{boolText(activeRule.excludeSuspended)} ｜ 包含ST：{boolText(activeRule.includeSt)}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>指标计算</CardTitle>
          <CardDescription>按日期范围计算平均/中位数指标。规则标识留空时，计算全部“已启用”规则。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border border-border/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="w-56 shrink-0 max-sm:w-full"
                type="date"
                value={computeForm.startDay}
                onChange={(e) => setComputeForm((prev) => ({ ...prev, startDay: e.target.value }))}
              />
              <Input
                className="w-56 shrink-0 max-sm:w-full"
                type="date"
                value={computeForm.endDay}
                onChange={(e) => setComputeForm((prev) => ({ ...prev, endDay: e.target.value }))}
              />
              <select
                className="h-9 w-80 shrink-0 rounded-md border border-input bg-transparent px-3 text-sm max-sm:w-full"
                value={computeForm.ruleKey}
                onChange={(e) => setComputeForm((prev) => ({ ...prev, ruleKey: e.target.value }))}
              >
                <option value="">规则标识（可空）：全部已启用规则</option>
                {rules.map((item) => (
                  <option key={item.id} value={item.ruleKey}>
                    {item.ruleKey}{item.isDefault ? '（默认）' : ''}{item.isEnabled ? '' : '（停用）'}
                  </option>
                ))}
              </select>
              <select
                className="h-9 w-80 shrink-0 rounded-md border border-input bg-transparent px-3 text-sm max-sm:w-full"
                value={computeForm.force}
                onChange={(e) => setComputeForm((prev) => ({ ...prev, force: e.target.value }))}
              >
                <option value="false">默认：若已有结果则跳过</option>
                <option value="true">强制重算：覆盖当日已有结果</option>
              </select>
              <Button className="w-32 shrink-0 max-sm:w-auto" onClick={() => submitCompute().catch(() => {})} disabled={computing}>
                {computing ? '计算中，请稍候...' : '执行计算'}
              </Button>
            </div>
          </div>
          {computing ? (
            <p className="text-xs text-muted-foreground">正在计算市场指标，样本较大时可能需要 10-60 秒。</p>
          ) : null}

          {computeResult ? (
            <div className="rounded-md border border-border/60 p-3 text-sm">
              <p>
                计算范围：{computeResult.startDay} ~ {computeResult.endDay} ｜ 交易日数：{computeResult.totalTradeDays || 0}
              </p>
              <p>
                规则执行数：{computeResult.totalRules} ｜ 成功：{computeResult.success} ｜ 失败：{computeResult.failed} ｜ 跳过：{computeResult.skipped || 0}
              </p>
              {Array.isArray(computeResult.daySummaries) && computeResult.daySummaries.length > 0 ? (
                <div className="mt-2 max-h-56 overflow-auto rounded border border-border/50">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1 text-left">交易日</th>
                        <th className="px-2 py-1 text-left">规则数</th>
                        <th className="px-2 py-1 text-left">成功</th>
                        <th className="px-2 py-1 text-left">失败</th>
                        <th className="px-2 py-1 text-left">跳过</th>
                      </tr>
                    </thead>
                    <tbody>
                      {computeResult.daySummaries.map((item) => (
                        <tr key={item.tradeDay} className="border-t border-border/40">
                          <td className="px-2 py-1">{item.tradeDay}</td>
                          <td className="px-2 py-1">{item.totalRules}</td>
                          <td className="px-2 py-1">{item.success}</td>
                          <td className="px-2 py-1">{item.failed}</td>
                          <td className="px-2 py-1">{item.skipped}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {!!computeResult.errors?.length ? (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground">失败明细：</p>
                  <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                    {computeResult.errors.map((item, idx) => (
                      <li key={`${item.tradeDay || 'day'}-${item.ruleKey}-${idx}`}>[{item.tradeDay || '--'}] {item.ruleKey}: {item.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>指标查询</CardTitle>
          <CardDescription>按日期范围查询指标结果。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-border/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="w-full min-w-[180px] flex-1 sm:w-40 sm:flex-none"
                type="date"
                value={queryForm.startDay}
                onChange={(e) => setQueryForm((prev) => ({ ...prev, startDay: e.target.value }))}
              />
              <Input
                className="w-full min-w-[180px] flex-1 sm:w-40 sm:flex-none"
                type="date"
                value={queryForm.endDay}
                onChange={(e) => setQueryForm((prev) => ({ ...prev, endDay: e.target.value }))}
              />
              <Input className="w-full min-w-[180px] flex-1 sm:w-44 sm:flex-none" value={SCOPE_KEY_LABEL_MAP.ALL_A} readOnly />
              <select
                className="h-9 w-full min-w-[220px] flex-1 rounded-md border border-input bg-transparent px-3 text-sm sm:w-56 sm:flex-none"
                value={queryForm.ruleKey}
                onChange={(e) => setQueryForm((prev) => ({ ...prev, ruleKey: e.target.value }))}
              >
                {rules.map((item) => (
                  <option key={item.id} value={item.ruleKey}>
                    {item.ruleKey}{item.isDefault ? '（默认）' : ''}
                  </option>
                ))}
              </select>
              <Input
                className="w-full min-w-[180px] flex-1 sm:w-44 sm:flex-none"
                value={queryForm.limit}
                onChange={(e) => setQueryForm((prev) => ({ ...prev, limit: e.target.value }))}
                placeholder="返回条数（例如 200）"
              />
              <Button
                className="min-w-[112px] w-auto"
                variant="secondary"
                onClick={() => queryRange().catch(() => {})}
                disabled={queryLoading}
              >
                查询结果
              </Button>
              <Button
                className="min-w-[112px] w-auto"
                variant="outline"
                onClick={handleShowTrend}
                disabled={queryLoading || !queryTrendData.length}
              >
                {showTrend ? '隐藏折线图' : '折线图'}
              </Button>
            </div>
          </div>

          {trendNotice ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {trendNotice}
            </div>
          ) : null}

          {showTrend && queryTrendData.length >= 10 ? (
            <div className="rounded-md border border-border/60 p-3">
              <p className="mb-2 text-sm font-medium">
                指标折线图（{queryForm.ruleKey || '默认规则'}，共 {queryTrendData.length} 天）
              </p>
              <p className="mb-2 text-xs text-muted-foreground">
                说明：每个交易日仅一个价格点，蓝线为平均股价，橙线为中位数股价。
              </p>
              <MetricTrendChart data={queryTrendData} height={360} className="w-full" />
            </div>
          ) : null}

          {queryResult?.items?.length ? (
            <div className="max-h-80 overflow-auto rounded-md border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1 text-left">交易日</th>
                    <th className="px-2 py-1 text-left">样本范围</th>
                    <th className="px-2 py-1 text-left">规则标识</th>
                    <th className="px-2 py-1 text-left">价格口径</th>
                    <th className="px-2 py-1 text-left">平均股价</th>
                    <th className="px-2 py-1 text-left">中位数股价</th>
                    <th className="px-2 py-1 text-left">样本数</th>
                    <th className="px-2 py-1 text-left">计算时间点</th>
                  </tr>
                </thead>
                <tbody>
                  {queryResult.items.map((item) => (
                    <tr key={item.id} className="border-t border-border/40">
                      <td className="px-2 py-1">{item.tradeDay}</td>
                      <td className="px-2 py-1">{SCOPE_KEY_LABEL_MAP[item.scopeKey] || item.scopeKey}</td>
                      <td className="px-2 py-1 font-mono">{item.ruleKey}</td>
                      <td className="px-2 py-1">{PRICE_MODE_LABEL_MAP[item.priceMode] || item.priceMode}</td>
                      <td className="px-2 py-1">{formatNumber(item.avgPrice)}</td>
                      <td className="px-2 py-1">{formatNumber(item.medianPrice)}</td>
                      <td className="px-2 py-1">{item.sampleSize}</td>
                      <td className="px-2 py-1">{formatDateTime(item.computedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

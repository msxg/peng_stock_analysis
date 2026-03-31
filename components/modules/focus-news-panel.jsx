'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { clientApi } from '@/lib/client-api';
import { formatSourceDateTime } from '@/lib/focus-news-time';

function formatDateTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatPublishedAt(value) {
  return formatSourceDateTime(value);
}

function todayText() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function statusClass(status) {
  const text = String(status || '').toLowerCase();
  if (text === 'completed') return 'text-emerald-700';
  if (text === 'failed') return 'text-red-600';
  if (text === 'running') return 'text-blue-700';
  return 'text-muted-foreground';
}

function pickDefaultSyncCategory(items = []) {
  const source = Array.isArray(items) ? items : [];
  const preferred = source.find((item) => Number(item.level || 0) >= 2);
  return preferred?.categoryKey || source[0]?.categoryKey || '';
}

function toPositiveInt(value, fallback = 500) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.max(n, 1), 5000);
}

function toBoolConfig(value, fallback = false) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return Boolean(fallback);
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return Boolean(fallback);
}

function toProviderConfigKey(providerKey = '') {
  const suffix = String(providerKey || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toUpperCase();
  return suffix ? `NEWS_PROVIDER_${suffix}_ENABLED` : 'NEWS_PROVIDER_TUSHARE_ENABLED';
}

export function FocusNewsPanel() {
  const today = useMemo(() => todayText(), []);
  const [providerKey, setProviderKey] = useState('tushare');
  const [catalogKeyword, setCatalogKeyword] = useState('');
  const [itemKeyword, setItemKeyword] = useState('');
  const [itemCategoryKey, setItemCategoryKey] = useState('');
  const [syncCategoryKey, setSyncCategoryKey] = useState('news');
  const [syncStartDate, setSyncStartDate] = useState(today);
  const [syncEndDate, setSyncEndDate] = useState(today);
  const [syncLimit, setSyncLimit] = useState('500');
  const [loading, setLoading] = useState(false);
  const [syncingCatalog, setSyncingCatalog] = useState(false);
  const [syncingItems, setSyncingItems] = useState(false);
  const [message, setMessage] = useState('');

  const [providers, setProviders] = useState([]);
  const [categories, setCategories] = useState([]);
  const [taxonomies, setTaxonomies] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [runs, setRuns] = useState([]);
  const [itemsPayload, setItemsPayload] = useState({ items: [], total: 0, page: 1, limit: 20 });
  const [selectedNewsUid, setSelectedNewsUid] = useState('');
  const [itemDetail, setItemDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [schedulerPayload, setSchedulerPayload] = useState({ scheduler: null, recentRuns: [] });
  const [schedulerLoading, setSchedulerLoading] = useState(false);
  const [schedulerTriggering, setSchedulerTriggering] = useState(false);
  const [schedulerConfigDraft, setSchedulerConfigDraft] = useState({
    syncEnabled: true,
    providerEnabled: true,
    tickSeconds: '60',
    schedulerConcurrency: '1',
    lookbackMinutes: '180',
    maxItemsPerRun: '1000',
  });
  const [savingSchedulerConfig, setSavingSchedulerConfig] = useState(false);
  const [providerCredentialDraft, setProviderCredentialDraft] = useState({
    tushareWebCookie: '',
  });
  const [savingProviderCredential, setSavingProviderCredential] = useState(false);
  const [policyDrafts, setPolicyDrafts] = useState({});
  const [savingPolicyKey, setSavingPolicyKey] = useState('');

  const filteredCategories = useMemo(() => {
    const q = String(catalogKeyword || '').trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((item) => {
      const text = `${item.name || ''} ${item.categoryKey || ''} ${item.parentCategoryKey || ''}`.toLowerCase();
      return text.includes(q);
    });
  }, [categories, catalogKeyword]);

  const filteredMappings = useMemo(() => {
    const q = String(catalogKeyword || '').trim().toLowerCase();
    if (!q) return mappings;
    return mappings.filter((item) => {
      const text = `${item.providerCategoryKey || ''} ${item.taxonomyKey || ''}`.toLowerCase();
      return text.includes(q);
    });
  }, [mappings, catalogKeyword]);

  const syncableCategories = useMemo(() => {
    const rows = categories.filter((item) => item.isActive !== false && Number(item.level || 0) >= 2);
    if (rows.length) return rows;
    return categories;
  }, [categories]);

  const summary = useMemo(() => {
    const completedRuns = runs.filter((item) => item.status === 'completed').length;
    const failedRuns = runs.filter((item) => item.status === 'failed').length;
    return {
      providerCount: providers.length,
      categoryCount: categories.length,
      taxonomyCount: taxonomies.length,
      mappingCount: mappings.length,
      completedRuns,
      failedRuns,
      itemCount: Number(itemsPayload?.total || 0),
    };
  }, [providers.length, categories.length, taxonomies.length, mappings.length, runs, itemsPayload?.total]);

  const schedulerSummary = useMemo(() => {
    const scheduler = schedulerPayload?.scheduler || {};
    return {
      started: scheduler.started === true,
      running: scheduler.running === true,
      schedulerConcurrency: Number(scheduler.schedulerConcurrency || 1),
      activeCategoryCount: Number(scheduler.activeCategoryCount || 0),
      stateRestored: scheduler.stateRestored === true,
      retryQueueSize: Number(scheduler.retryQueueSize || 0),
      lastTickAt: scheduler.lastTickAt || '',
      statePersistedAt: scheduler.statePersistedAt || '',
      recentCount: Array.isArray(schedulerPayload?.recentRuns) ? schedulerPayload.recentRuns.length : 0,
    };
  }, [schedulerPayload]);

  const schedulerCategories = useMemo(
    () => categories.filter((item) => Number(item.level || 0) >= 2),
    [categories],
  );

  async function loadSchedulerStatus({ silent = false, nextProviderKey = providerKey } = {}) {
    if (!silent) setSchedulerLoading(true);
    try {
      const payload = await clientApi.focusNews.schedulerStatus({
        providerKey: nextProviderKey,
        limit: 8,
      });
      setSchedulerPayload({
        scheduler: payload?.scheduler || null,
        recentRuns: Array.isArray(payload?.recentRuns) ? payload.recentRuns : [],
      });
    } catch (error) {
      if (!silent) setMessage(`调度状态加载失败：${error.message || '未知错误'}`);
    } finally {
      if (!silent) setSchedulerLoading(false);
    }
  }

  async function runSchedulerNow() {
    setSchedulerTriggering(true);
    try {
      const payload = await clientApi.focusNews.schedulerRun({
        providerKey,
        limit: 8,
      });
      const skipped = payload?.triggered?.skipped === true;
      setSchedulerPayload({
        scheduler: payload?.scheduler || payload?.triggered?.status || null,
        recentRuns: Array.isArray(payload?.recentRuns) ? payload.recentRuns : [],
      });
      setMessage(skipped ? '调度器正在执行中，本次已跳过重入。' : '已触发一次调度执行。');
      await loadAll({
        silent: true,
        nextProviderKey: providerKey,
        nextItemCategoryKey: itemCategoryKey,
        nextItemKeyword: itemKeyword,
      });
    } catch (error) {
      setMessage(`调度触发失败：${error.message || '未知错误'}`);
    } finally {
      setSchedulerTriggering(false);
    }
  }

  function updateSchedulerConfigDraft(patch = {}) {
    setSchedulerConfigDraft((prev) => ({
      ...prev,
      ...(patch || {}),
    }));
  }

  function updateProviderCredentialDraft(patch = {}) {
    setProviderCredentialDraft((prev) => ({
      ...prev,
      ...(patch || {}),
    }));
  }

  async function saveSchedulerConfig() {
    setSavingSchedulerConfig(true);
    try {
      const schedulerConcurrency = Math.max(
        1,
        Math.min(Math.trunc(Number(schedulerConfigDraft.schedulerConcurrency) || 1), 8),
      );
      const providerConfigKey = toProviderConfigKey(providerKey);
      await clientApi.system.updateConfig({
        NEWS_SYNC_ENABLED: schedulerConfigDraft.syncEnabled ? 'true' : 'false',
        [providerConfigKey]: schedulerConfigDraft.providerEnabled ? 'true' : 'false',
        NEWS_SYNC_TICK_SECONDS: String(toPositiveInt(schedulerConfigDraft.tickSeconds, 60)),
        NEWS_SYNC_LOOKBACK_MINUTES: String(toPositiveInt(schedulerConfigDraft.lookbackMinutes, 180)),
        NEWS_MAX_ITEMS_PER_RUN: String(toPositiveInt(schedulerConfigDraft.maxItemsPerRun, 1000)),
        NEWS_SCHEDULER_CONCURRENCY: String(schedulerConcurrency),
      });
      setMessage('调度参数已保存');
      await loadAll({
        silent: true,
        nextProviderKey: providerKey,
        nextItemCategoryKey: itemCategoryKey,
        nextItemKeyword: itemKeyword,
      });
    } catch (error) {
      setMessage(`调度参数保存失败：${error.message || '未知错误'}`);
    } finally {
      setSavingSchedulerConfig(false);
    }
  }

  async function saveProviderCredential() {
    if (providerKey !== 'tushare') {
      setMessage(`当前 provider ${providerKey || '--'} 暂无可维护的网页 Cookie 配置`);
      return;
    }

    setSavingProviderCredential(true);
    try {
      await clientApi.system.updateConfig({
        TUSHARE_WEB_COOKIE: String(providerCredentialDraft.tushareWebCookie || ''),
      });
      setMessage(
        String(providerCredentialDraft.tushareWebCookie || '').trim()
          ? 'Tushare Web Cookie 已保存，news 分类会在接口无数据时自动用网页兜底。'
          : 'Tushare Web Cookie 已清空，将仅使用接口采集或环境变量兜底。',
      );
      await loadAll({
        silent: true,
        nextProviderKey: providerKey,
        nextItemCategoryKey: itemCategoryKey,
        nextItemKeyword: itemKeyword,
      });
    } catch (error) {
      setMessage(`Tushare Web Cookie 保存失败：${error.message || '未知错误'}`);
    } finally {
      setSavingProviderCredential(false);
    }
  }

  function updatePolicyDraft(categoryKey, patch = {}) {
    const key = String(categoryKey || '').trim();
    if (!key) return;
    setPolicyDrafts((prev) => ({
      ...prev,
      [key]: {
        ...(prev?.[key] || {}),
        ...patch,
      },
    }));
  }

  async function saveSchedulerPolicy(categoryKey) {
    const key = String(categoryKey || '').trim();
    if (!key) return;
    const draft = policyDrafts?.[key] || {};
    setSavingPolicyKey(key);
    try {
      await clientApi.focusNews.schedulerCategoryPolicy(key, {
        providerKey,
        schedulerEnabled: draft.schedulerEnabled !== false,
        schedulerPriority: toPositiveInt(draft.schedulerPriority, 100),
      });
      setMessage(`调度策略已更新：${key}`);
      await loadAll({
        silent: true,
        nextProviderKey: providerKey,
        nextItemCategoryKey: itemCategoryKey,
        nextItemKeyword: itemKeyword,
      });
    } catch (error) {
      setMessage(`调度策略更新失败：${error.message || '未知错误'}`);
    } finally {
      setSavingPolicyKey('');
    }
  }

  async function loadAll({
    silent = false,
    nextProviderKey = providerKey,
    nextItemCategoryKey = itemCategoryKey,
    nextItemKeyword = itemKeyword,
  } = {}) {
    if (!silent) setLoading(true);
    try {
      const [
        providersPayload,
        categoriesPayload,
        taxonomiesPayload,
        mappingsPayload,
        runsPayload,
        itemsResponse,
        schedulerStatusPayload,
        systemConfigPayload,
      ] = await Promise.all([
        clientApi.focusNews.providers(),
        clientApi.focusNews.categories({ providerKey: nextProviderKey }),
        clientApi.focusNews.taxonomies(),
        clientApi.focusNews.mappings({ providerKey: nextProviderKey }),
        clientApi.focusNews.syncRuns({ providerKey: nextProviderKey, limit: 20 }),
        clientApi.focusNews({
          providerKey: nextProviderKey,
          categoryKey: nextItemCategoryKey,
          q: nextItemKeyword,
          limit: 20,
          page: 1,
        }),
        clientApi.focusNews.schedulerStatus({ providerKey: nextProviderKey, limit: 8 }),
        clientApi.system.getConfig({ maskToken: false }),
      ]);
      setProviders(Array.isArray(providersPayload?.items) ? providersPayload.items : []);
      setCategories(Array.isArray(categoriesPayload?.items) ? categoriesPayload.items : []);
      setTaxonomies(Array.isArray(taxonomiesPayload?.items) ? taxonomiesPayload.items : []);
      setMappings(Array.isArray(mappingsPayload?.items) ? mappingsPayload.items : []);
      setRuns(Array.isArray(runsPayload?.items) ? runsPayload.items : []);
      setItemsPayload({
        items: Array.isArray(itemsResponse?.items) ? itemsResponse.items : [],
        total: Number(itemsResponse?.total || 0),
        page: Number(itemsResponse?.page || 1),
        limit: Number(itemsResponse?.limit || 20),
      });
      setSchedulerPayload({
        scheduler: schedulerStatusPayload?.scheduler || null,
        recentRuns: Array.isArray(schedulerStatusPayload?.recentRuns) ? schedulerStatusPayload.recentRuns : [],
      });
      const configItems = Array.isArray(systemConfigPayload?.items) ? systemConfigPayload.items : [];
      const configMap = new Map(configItems.map((item) => [item.key, String(item.value ?? '')]));
      const providerConfigKey = toProviderConfigKey(nextProviderKey);
      setSchedulerConfigDraft({
        syncEnabled: toBoolConfig(configMap.get('NEWS_SYNC_ENABLED'), true),
        providerEnabled: toBoolConfig(configMap.get(providerConfigKey), true),
        tickSeconds: configMap.get('NEWS_SYNC_TICK_SECONDS') || '60',
        schedulerConcurrency: configMap.get('NEWS_SCHEDULER_CONCURRENCY') || '1',
        lookbackMinutes: configMap.get('NEWS_SYNC_LOOKBACK_MINUTES') || '180',
        maxItemsPerRun: configMap.get('NEWS_MAX_ITEMS_PER_RUN') || '1000',
      });
      setProviderCredentialDraft({
        tushareWebCookie: configMap.get('TUSHARE_WEB_COOKIE') || '',
      });
      if (!silent) {
        setMessage(`加载完成：分类 ${categoriesPayload?.items?.length || 0} 条，资讯 ${itemsResponse?.total || 0} 条`);
      }
    } catch (error) {
      setMessage(`加载失败：${error.message || '未知错误'}`);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadItems({
    silent = false,
    nextProviderKey = providerKey,
    nextItemCategoryKey = itemCategoryKey,
    nextItemKeyword = itemKeyword,
  } = {}) {
    if (!silent) setLoading(true);
    try {
      const itemsResponse = await clientApi.focusNews({
        providerKey: nextProviderKey,
        categoryKey: nextItemCategoryKey,
        q: nextItemKeyword,
        limit: 20,
        page: 1,
      });
      setItemsPayload({
        items: Array.isArray(itemsResponse?.items) ? itemsResponse.items : [],
        total: Number(itemsResponse?.total || 0),
        page: Number(itemsResponse?.page || 1),
        limit: Number(itemsResponse?.limit || 20),
      });
      if (!silent) setMessage(`资讯列表已刷新，共 ${itemsResponse?.total || 0} 条`);
    } catch (error) {
      setMessage(`资讯加载失败：${error.message || '未知错误'}`);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadItemDetail(newsUid, { silent = false } = {}) {
    const uid = String(newsUid || '').trim();
    if (!uid) {
      setItemDetail(null);
      return;
    }
    if (!silent) setDetailLoading(true);
    try {
      const payload = await clientApi.focusNews.itemDetail(uid);
      setItemDetail(payload?.item || null);
      setSelectedNewsUid(uid);
    } catch (error) {
      if (!silent) setMessage(`资讯详情加载失败：${error.message || '未知错误'}`);
      setItemDetail(null);
    } finally {
      if (!silent) setDetailLoading(false);
    }
  }

  async function syncCatalog() {
    setSyncingCatalog(true);
    setMessage('');
    try {
      const payload = await clientApi.focusNews.syncCatalog({
        providerKey,
        triggerType: 'manual',
      });
      const count = Array.isArray(payload?.categories) ? payload.categories.length : 0;
      setMessage(`分类同步成功：${providerKey} 共 ${count} 条，runId=${payload?.run?.runId || '--'}`);
      await loadAll({
        silent: true,
        nextProviderKey: providerKey,
        nextItemCategoryKey: itemCategoryKey,
        nextItemKeyword: itemKeyword,
      });
    } catch (error) {
      setMessage(`分类同步失败：${error.message || '未知错误'}`);
    } finally {
      setSyncingCatalog(false);
    }
  }

  async function syncItems() {
    if (!syncCategoryKey) {
      setMessage('请选择要采集的分类');
      return;
    }
    setSyncingItems(true);
    setMessage('');
    try {
      const payload = await clientApi.focusNews.syncItems({
        providerKey,
        categoryKey: syncCategoryKey,
        startDate: syncStartDate || today,
        endDate: syncEndDate || syncStartDate || today,
        limit: toPositiveInt(syncLimit, 500),
        triggerType: 'manual',
      });
      const result = payload?.result || {};
      setMessage(
        `资讯同步成功：raw=${result.rawCount || 0}，入库=${result.insertedCount || 0}，更新=${result.updatedCount || 0}，去重=${result.dedupedCount || 0}，runId=${payload?.run?.runId || '--'}`,
      );
      setItemCategoryKey(syncCategoryKey);
      await loadAll({
        silent: true,
        nextProviderKey: providerKey,
        nextItemCategoryKey: syncCategoryKey,
        nextItemKeyword: itemKeyword,
      });
    } catch (error) {
      setMessage(`资讯同步失败：${error.message || '未知错误'}`);
    } finally {
      setSyncingItems(false);
    }
  }

  useEffect(() => {
    loadAll({
      silent: false,
      nextProviderKey: providerKey,
      nextItemCategoryKey: itemCategoryKey,
      nextItemKeyword: itemKeyword,
    }).catch(() => {});
  }, [providerKey]);

  useEffect(() => {
    const rows = Array.isArray(itemsPayload?.items) ? itemsPayload.items : [];
    if (!rows.length) {
      setSelectedNewsUid('');
      setItemDetail(null);
      return;
    }
    const found = rows.some((item) => item.newsUid === selectedNewsUid);
    const nextUid = found ? selectedNewsUid : rows[0]?.newsUid;
    if (!nextUid) return;
    if (nextUid !== selectedNewsUid) {
      setSelectedNewsUid(nextUid);
    }
    loadItemDetail(nextUid, { silent: true }).catch(() => {});
  }, [itemsPayload]);

  useEffect(() => {
    const keySet = new Set(syncableCategories.map((item) => item.categoryKey));
    if (!syncCategoryKey || !keySet.has(syncCategoryKey)) {
      const next = pickDefaultSyncCategory(syncableCategories);
      if (next && next !== syncCategoryKey) setSyncCategoryKey(next);
    }
    if (itemCategoryKey && !keySet.has(itemCategoryKey)) {
      setItemCategoryKey('');
    }
  }, [syncableCategories, syncCategoryKey, itemCategoryKey]);

  useEffect(() => {
    setPolicyDrafts(() => {
      const next = {};
      schedulerCategories.forEach((item) => {
        const key = String(item.categoryKey || '').trim();
        if (!key) return;
        next[key] = {
          schedulerEnabled: item.schedulerEnabled !== false,
          schedulerPriority: String(item.schedulerPriority || item.sortOrder || 100),
        };
      });
      return next;
    });
  }, [schedulerCategories]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>资讯数据管理台</CardTitle>
          <CardDescription>面向系统运维：分类资产、采集任务、调度策略与数据校验。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={providerKey}
              onChange={(event) => setProviderKey(event.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {providers.map((item) => (
                <option key={item.providerKey || item.key} value={item.providerKey || item.key}>
                  {item.name || item.providerKey || item.key}
                </option>
              ))}
              {!providers.length ? <option value="tushare">tushare</option> : null}
            </select>
            <Input
              value={catalogKeyword}
              onChange={(event) => setCatalogKeyword(event.target.value)}
              placeholder="筛选分类/映射：名称、分类Key"
            />
            <Button
              onClick={() => loadAll({
                silent: false,
                nextProviderKey: providerKey,
                nextItemCategoryKey: itemCategoryKey,
                nextItemKeyword: itemKeyword,
              })}
              disabled={loading || syncingCatalog || syncingItems || schedulerLoading || schedulerTriggering}
            >
              刷新
            </Button>
            <Button variant="secondary" onClick={syncCatalog} disabled={loading || syncingCatalog || syncingItems || schedulerTriggering}>
              {syncingCatalog ? '目录同步中...' : '同步分类目录'}
            </Button>
          </div>

          <div className="grid gap-2 lg:grid-cols-[1.1fr,1fr,1fr,0.7fr,auto]">
            <select
              value={syncCategoryKey}
              onChange={(event) => setSyncCategoryKey(event.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {syncableCategories.map((item) => (
                <option key={item.categoryKey} value={item.categoryKey}>
                  {item.name || item.categoryKey} ({item.categoryKey})
                </option>
              ))}
              {!syncableCategories.length ? <option value="">暂无可采集分类</option> : null}
            </select>
            <Input type="date" value={syncStartDate} onChange={(event) => setSyncStartDate(event.target.value)} />
            <Input type="date" value={syncEndDate} onChange={(event) => setSyncEndDate(event.target.value)} />
            <Input
              value={syncLimit}
              onChange={(event) => setSyncLimit(event.target.value)}
              placeholder="采集上限"
            />
            <Button onClick={syncItems} disabled={loading || syncingCatalog || syncingItems || schedulerTriggering || !syncCategoryKey}>
              {syncingItems ? '资讯同步中...' : '同步资讯数据'}
            </Button>
          </div>

          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

          <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-7">
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">Provider</p>
              <p className="text-sm font-semibold">{summary.providerCount}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">分类数</p>
              <p className="text-sm font-semibold">{summary.categoryCount}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">内部分类</p>
              <p className="text-sm font-semibold">{summary.taxonomyCount}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">映射数</p>
              <p className="text-sm font-semibold">{summary.mappingCount}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">同步成功</p>
              <p className="text-sm font-semibold">{summary.completedRuns}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">同步失败</p>
              <p className="text-sm font-semibold">{summary.failedRuns}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">资讯条数</p>
              <p className="text-sm font-semibold">{summary.itemCount}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>调度器状态</CardTitle>
          <CardDescription>定时增量采集、失败重试、运行锁可观测。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => loadSchedulerStatus({ silent: false, nextProviderKey: providerKey })}
              disabled={schedulerLoading || schedulerTriggering || loading || syncingCatalog || syncingItems || savingSchedulerConfig}
            >
              {schedulerLoading ? '加载中...' : '刷新调度状态'}
            </Button>
            <Button
              onClick={runSchedulerNow}
              disabled={schedulerLoading || schedulerTriggering || loading || syncingCatalog || syncingItems || savingSchedulerConfig}
            >
              {schedulerTriggering ? '执行中...' : '立即执行一次'}
            </Button>
          </div>

          <div className="space-y-2 rounded-lg border border-border/60 p-3">
            <p className="text-sm font-medium">调度参数</p>
            <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
              <select
                value={schedulerConfigDraft.syncEnabled ? '1' : '0'}
                onChange={(event) => updateSchedulerConfigDraft({ syncEnabled: event.target.value === '1' })}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                disabled={savingSchedulerConfig}
              >
                <option value="1">总开关：启用</option>
                <option value="0">总开关：停用</option>
              </select>
              <select
                value={schedulerConfigDraft.providerEnabled ? '1' : '0'}
                onChange={(event) => updateSchedulerConfigDraft({ providerEnabled: event.target.value === '1' })}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                disabled={savingSchedulerConfig}
              >
                <option value="1">{providerKey || 'provider'}：启用</option>
                <option value="0">{providerKey || 'provider'}：停用</option>
              </select>
              <Input
                value={schedulerConfigDraft.tickSeconds}
                onChange={(event) => updateSchedulerConfigDraft({ tickSeconds: event.target.value })}
                placeholder="调度周期(秒)"
                disabled={savingSchedulerConfig}
              />
              <Input
                value={schedulerConfigDraft.schedulerConcurrency}
                onChange={(event) => updateSchedulerConfigDraft({ schedulerConcurrency: event.target.value })}
                placeholder="并发(1-8)"
                disabled={savingSchedulerConfig}
              />
              <Input
                value={schedulerConfigDraft.lookbackMinutes}
                onChange={(event) => updateSchedulerConfigDraft({ lookbackMinutes: event.target.value })}
                placeholder="回看窗口(分钟)"
                disabled={savingSchedulerConfig}
              />
              <Input
                value={schedulerConfigDraft.maxItemsPerRun}
                onChange={(event) => updateSchedulerConfigDraft({ maxItemsPerRun: event.target.value })}
                placeholder="单次上限"
                disabled={savingSchedulerConfig}
              />
            </div>
            <div>
              <Button
                variant="secondary"
                onClick={saveSchedulerConfig}
                disabled={savingSchedulerConfig || schedulerLoading || schedulerTriggering || loading || syncingCatalog || syncingItems}
              >
                {savingSchedulerConfig ? '保存中...' : '保存调度参数'}
              </Button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-9">
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">已启动</p>
              <p className={`text-sm font-semibold ${schedulerSummary.started ? 'text-emerald-700' : 'text-red-600'}`}>
                {schedulerSummary.started ? '是' : '否'}
              </p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">运行中</p>
              <p className={`text-sm font-semibold ${schedulerSummary.running ? 'text-blue-700' : 'text-muted-foreground'}`}>
                {schedulerSummary.running ? '是' : '否'}
              </p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">重试队列</p>
              <p className="text-sm font-semibold">{schedulerSummary.retryQueueSize}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">调度并发</p>
              <p className="text-sm font-semibold">{schedulerSummary.schedulerConcurrency}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">激活分类</p>
              <p className="text-sm font-semibold">{schedulerSummary.activeCategoryCount}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">已恢复状态</p>
              <p className={`text-sm font-semibold ${schedulerSummary.stateRestored ? 'text-emerald-700' : 'text-muted-foreground'}`}>
                {schedulerSummary.stateRestored ? '是' : '否'}
              </p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">最近 Tick</p>
              <p className="text-sm font-semibold">{formatDateTime(schedulerSummary.lastTickAt)}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">状态落盘</p>
              <p className="text-sm font-semibold">{formatDateTime(schedulerSummary.statePersistedAt)}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">最近调度任务</p>
              <p className="text-sm font-semibold">{schedulerSummary.recentCount}</p>
            </div>
          </div>

          <div className="max-h-[260px] overflow-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">RunID</th>
                  <th className="px-3 py-2 text-left">状态</th>
                  <th className="px-3 py-2 text-left">模式</th>
                  <th className="px-3 py-2 text-left">分类</th>
                  <th className="px-3 py-2 text-left">raw/入库</th>
                  <th className="px-3 py-2 text-left">请求时间</th>
                </tr>
              </thead>
              <tbody>
                {(schedulerPayload.recentRuns || []).map((item) => (
                  <tr key={`sched-${item.runId}`} className="border-t border-border/40">
                    <td className="px-3 py-2 font-mono text-xs">{item.runId || '-'}</td>
                    <td className={`px-3 py-2 ${statusClass(item.status)}`}>{item.status || '-'}</td>
                    <td className="px-3 py-2">{item.syncMode || '-'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{item.categoryKey || '-'}</td>
                    <td className="px-3 py-2">{item.rawCount || 0}/{item.insertedCount || 0}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDateTime(item.requestedAt)}</td>
                  </tr>
                ))}
                {!schedulerPayload.recentRuns?.length ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">暂无调度任务记录</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">分类调度策略</div>
            <div className="max-h-[260px] overflow-auto rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">分类</th>
                    <th className="px-3 py-2 text-left">分类Key</th>
                    <th className="px-3 py-2 text-left">启用调度</th>
                    <th className="px-3 py-2 text-left">优先级</th>
                    <th className="px-3 py-2 text-left">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {schedulerCategories.map((item) => {
                    const key = String(item.categoryKey || '');
                    const draft = policyDrafts?.[key] || {
                      schedulerEnabled: item.schedulerEnabled !== false,
                      schedulerPriority: String(item.schedulerPriority || item.sortOrder || 100),
                    };
                    const isSaving = savingPolicyKey === key;
                    return (
                      <tr key={`policy-${key}`} className="border-t border-border/40">
                        <td className="px-3 py-2">{item.name || '-'}</td>
                        <td className="px-3 py-2 font-mono text-xs">{key || '-'}</td>
                        <td className="px-3 py-2">
                          <select
                            value={draft.schedulerEnabled === false ? '0' : '1'}
                            onChange={(event) => updatePolicyDraft(key, { schedulerEnabled: event.target.value === '1' })}
                            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                            disabled={isSaving}
                          >
                            <option value="1">启用</option>
                            <option value="0">停用</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            value={draft.schedulerPriority}
                            onChange={(event) => updatePolicyDraft(key, { schedulerPriority: event.target.value })}
                            className="h-8 w-24"
                            disabled={isSaving}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => saveSchedulerPolicy(key)}
                            disabled={isSaving || savingSchedulerConfig || loading || schedulerLoading || schedulerTriggering}
                          >
                            {isSaving ? '保存中...' : '保存'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {!schedulerCategories.length ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">暂无可配置分类</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      {providerKey === 'tushare' ? (
        <Card>
          <CardHeader>
            <CardTitle>Tushare 网页 Cookie</CardTitle>
            <CardDescription>
              `news` 分类当前采用“接口优先，网页兜底”模式。这里保存的 Cookie 会持久化到系统配置；若失效，后端会输出告警日志提醒更新。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <textarea
              value={providerCredentialDraft.tushareWebCookie}
              onChange={(event) => updateProviderCredentialDraft({ tushareWebCookie: event.target.value })}
              placeholder="session-id=...; uid=...; username=..."
              className="min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
              spellCheck={false}
              autoComplete="off"
              disabled={savingProviderCredential}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={saveProviderCredential}
                disabled={savingProviderCredential || loading || syncingCatalog || syncingItems || schedulerLoading || schedulerTriggering}
              >
                {savingProviderCredential ? '保存中...' : '保存 Cookie'}
              </Button>
              <p className="text-xs text-muted-foreground">
                优先读取系统配置中的 Cookie；为空时才回退到环境变量 `TUSHARE_WEB_COOKIE`。
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Provider 分类目录</CardTitle>
            <CardDescription>来源分类资产（当前 provider）。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[420px] overflow-auto rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">名称</th>
                    <th className="px-3 py-2 text-left">分类Key</th>
                    <th className="px-3 py-2 text-left">父级</th>
                    <th className="px-3 py-2 text-left">层级</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCategories.map((item) => (
                    <tr key={`${item.providerKey}-${item.categoryKey}`} className="border-t border-border/40">
                      <td className="px-3 py-2">{item.name || '-'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{item.categoryKey || '-'}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{item.parentCategoryKey || '-'}</td>
                      <td className="px-3 py-2">{item.level}</td>
                    </tr>
                  ))}
                  {!filteredCategories.length ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">暂无分类目录数据</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>分类映射</CardTitle>
            <CardDescription>Provider 分类 {'->'} 内部分类映射。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[420px] overflow-auto rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">来源分类</th>
                    <th className="px-3 py-2 text-left">内部分类</th>
                    <th className="px-3 py-2 text-left">置信度</th>
                    <th className="px-3 py-2 text-left">类型</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMappings.map((item) => (
                    <tr key={`${item.providerKey}-${item.providerCategoryKey}-${item.taxonomyKey}`} className="border-t border-border/40">
                      <td className="px-3 py-2 font-mono text-xs">{item.providerCategoryKey || '-'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{item.taxonomyKey || '-'}</td>
                      <td className="px-3 py-2">{Number(item.confidence || 0).toFixed(2)}</td>
                      <td className="px-3 py-2">{item.mappingType || '-'}</td>
                    </tr>
                  ))}
                  {!filteredMappings.length ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">暂无映射数据</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>同步运行记录</CardTitle>
          <CardDescription>最近目录/资讯同步任务状态。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[320px] overflow-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">RunID</th>
                  <th className="px-3 py-2 text-left">状态</th>
                  <th className="px-3 py-2 text-left">模式</th>
                  <th className="px-3 py-2 text-left">分类</th>
                  <th className="px-3 py-2 text-left">请求时间</th>
                  <th className="px-3 py-2 text-left">完成时间</th>
                  <th className="px-3 py-2 text-left">raw/标准</th>
                  <th className="px-3 py-2 text-left">入库/更新/去重</th>
                  <th className="px-3 py-2 text-left">失败</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((item) => (
                  <tr key={item.runId} className="border-t border-border/40">
                    <td className="px-3 py-2 font-mono text-xs">{item.runId || '-'}</td>
                    <td className={`px-3 py-2 ${statusClass(item.status)}`}>{item.status || '-'}</td>
                    <td className="px-3 py-2">{item.syncMode || '-'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{item.categoryKey || '-'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDateTime(item.requestedAt)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDateTime(item.finishedAt)}</td>
                    <td className="px-3 py-2">{item.rawCount || 0}/{item.normalizedCount || 0}</td>
                    <td className="px-3 py-2">{item.insertedCount || 0}/{item.updatedCount || 0}/{item.dedupedCount || 0}</td>
                    <td className="px-3 py-2">{item.failedCount || 0}</td>
                  </tr>
                ))}
                {!runs.length ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">暂无同步记录</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>资讯校验查询</CardTitle>
          <CardDescription>用于抽检已入库资讯资产，可按分类与关键词过滤并查看详情。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={itemCategoryKey}
              onChange={(event) => setItemCategoryKey(event.target.value)}
              className="h-9 min-w-[220px] rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">全部分类</option>
              {syncableCategories.map((item) => (
                <option key={`query-${item.categoryKey}`} value={item.categoryKey}>
                  {item.name || item.categoryKey} ({item.categoryKey})
                </option>
              ))}
            </select>
            <Input
              value={itemKeyword}
              onChange={(event) => setItemKeyword(event.target.value)}
              placeholder="关键词检索：标题/摘要/正文"
            />
            <Button
              onClick={() => loadItems({
                silent: false,
                nextProviderKey: providerKey,
                nextItemCategoryKey: itemCategoryKey,
                nextItemKeyword: itemKeyword,
              })}
              disabled={loading || syncingCatalog || syncingItems}
            >
              查询
            </Button>
          </div>

          <div className="max-h-[420px] overflow-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">发布时间</th>
                  <th className="px-3 py-2 text-left">分类</th>
                  <th className="px-3 py-2 text-left">标题</th>
                  <th className="px-3 py-2 text-left">来源</th>
                </tr>
              </thead>
              <tbody>
                {itemsPayload.items.map((item) => (
                  <tr
                    key={`${item.newsUid}-${item.id}`}
                    className={`cursor-pointer border-t border-border/40 hover:bg-muted/40 ${item.newsUid === selectedNewsUid ? 'bg-muted/50' : ''}`}
                    onClick={() => loadItemDetail(item.newsUid, { silent: false })}
                  >
                    <td className="px-3 py-2 text-muted-foreground">{formatPublishedAt(item.publishedAt)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{item.providerCategoryKey || '-'}</td>
                    <td className="px-3 py-2">
                      <p className="line-clamp-1">{item.title || '-'}</p>
                      {item.summary ? <p className="line-clamp-1 text-xs text-muted-foreground">{item.summary}</p> : null}
                    </td>
                    <td className="px-3 py-2">{item.sourceName || '-'}</td>
                  </tr>
                ))}
                {!itemsPayload.items.length ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">暂无资讯数据</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            {detailLoading ? <p className="text-sm text-muted-foreground">详情加载中...</p> : null}
            {!detailLoading && !itemDetail ? <p className="text-sm text-muted-foreground">请选择一条资讯查看详情</p> : null}
            {!detailLoading && itemDetail ? (
              <div className="space-y-2">
                <div className="space-y-1">
                  <h3 className="text-base font-semibold">{itemDetail.title || '-'}</h3>
                  <p className="text-xs text-muted-foreground">
                    {itemDetail.sourceName || '-'} | {formatPublishedAt(itemDetail.publishedAt)} | {itemDetail.providerCategoryKey || '-'}
                  </p>
                  {itemDetail.url ? (
                    <a
                      href={itemDetail.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-600 underline"
                    >
                      打开原文链接
                    </a>
                  ) : null}
                </div>
                {itemDetail.summary ? (
                  <p className="rounded-md border border-border/50 bg-background px-2 py-1 text-sm text-muted-foreground">
                    {itemDetail.summary}
                  </p>
                ) : null}
                <div className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-md border border-border/50 bg-background px-3 py-2 text-sm leading-6">
                  {itemDetail.content || itemDetail.summary || '暂无正文'}
                </div>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

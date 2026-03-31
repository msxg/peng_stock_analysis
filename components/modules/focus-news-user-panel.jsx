'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock3, ExternalLink, Flame, Search, TrendingUp, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { clientApi } from '@/lib/client-api';
import { formatSourceDateTime, formatSourceRelativeTime, toSourceTimestamp } from '@/lib/focus-news-time';

const PAGE_LIMIT = 18;
const DETAIL_TRIGGER_SELECTOR = '[data-focus-news-detail-trigger="true"]';
const AUTO_REFRESH_OPTIONS = [
  { value: 0, label: '关闭' },
  { value: 15000, label: '15 秒' },
  { value: 30000, label: '30 秒' },
  { value: 60000, label: '1 分钟' },
  { value: 180000, label: '3 分钟' },
];
const TITLE_STOP_WORDS = new Set([
  '公司',
  '市场',
  '板块',
  '今日',
  '消息',
  '相关',
  '数据',
  '发布',
  '公告',
  '中国',
  '进行',
  '关于',
  '表示',
]);

function formatDateTime(value) {
  return formatSourceDateTime(value);
}

function formatRelativeTime(value) {
  return formatSourceRelativeTime(value);
}

function toItemsPayload(payload = {}) {
  return {
    items: Array.isArray(payload?.items) ? payload.items : [],
    total: Number(payload?.total || 0),
    page: Number(payload?.page || 1),
    limit: Number(payload?.limit || PAGE_LIMIT),
  };
}

function pickSearchableCategories(items = []) {
  const rows = Array.isArray(items)
    ? items.filter((item) => item.isActive !== false && Number(item.level || 0) >= 2)
    : [];
  if (rows.length) return rows;
  return Array.isArray(items) ? items : [];
}

function buildFlatCategoryTags(items = []) {
  const map = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = String(item?.categoryKey || '').trim();
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, {
        key,
        name: item?.name || key,
        sortOrder: Number(item?.sortOrder || 100),
      });
    }
  });
  return [...map.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN'));
}

function toTimestamp(value) {
  return toSourceTimestamp(value);
}

function sortItems(items = [], mode = 'latest') {
  const rows = Array.isArray(items) ? [...items] : [];
  if (mode === 'hot') {
    rows.sort((a, b) => {
      const hotDelta = Number(b?.hotScore || 0) - Number(a?.hotScore || 0);
      if (hotDelta !== 0) return hotDelta;
      return toTimestamp(b?.publishedAt) - toTimestamp(a?.publishedAt);
    });
    return rows;
  }
  rows.sort((a, b) => toTimestamp(b?.publishedAt) - toTimestamp(a?.publishedAt));
  return rows;
}

function extractHotWords(items = [], max = 10) {
  const hit = new Map();
  (Array.isArray(items) ? items : []).slice(0, 120).forEach((item) => {
    const title = String(item?.title || '');
    const words = title.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,}/g) || [];
    words.forEach((word) => {
      const key = word.trim();
      if (!key) return;
      if (TITLE_STOP_WORDS.has(key)) return;
      hit.set(key, Number(hit.get(key) || 0) + 1);
    });
  });
  return [...hit.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([word, count]) => ({ word, count }));
}

function mergeUniqueByUid(prevRows = [], nextRows = []) {
  const map = new Map();
  [...prevRows, ...nextRows].forEach((item) => {
    const key = String(item?.newsUid || item?.id || '');
    if (!key) return;
    map.set(key, item);
  });
  return [...map.values()];
}

function fallbackProviders() {
  return [
    { providerKey: 'tushare', name: 'Tushare 资讯源' },
    { providerKey: 'xueqiu', name: '雪球 7x24' },
  ];
}

export function FocusNewsUserPanel() {
  const [providerKey, setProviderKey] = useState('');
  const [providers, setProviders] = useState([]);
  const [categories, setCategories] = useState([]);
  const [itemCategoryKey, setItemCategoryKey] = useState('');
  const [itemKeyword, setItemKeyword] = useState('');
  const [sortMode, setSortMode] = useState('latest');
  const [autoRefreshMs, setAutoRefreshMs] = useState(0);
  const [itemsPayload, setItemsPayload] = useState({ items: [], total: 0, page: 1, limit: PAGE_LIMIT });
  const [selectedNewsUid, setSelectedNewsUid] = useState('');
  const [itemDetail, setItemDetail] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [message, setMessage] = useState('');
  const detailDrawerRef = useRef(null);

  const searchableCategories = useMemo(() => pickSearchableCategories(categories), [categories]);

  const categoryNameMap = useMemo(() => {
    const map = new Map();
    searchableCategories.forEach((item) => {
      const key = String(item?.categoryKey || '').trim();
      if (!key) return;
      map.set(key, item.name || key);
    });
    return map;
  }, [searchableCategories]);

  const autoRefreshLabel = useMemo(
    () => AUTO_REFRESH_OPTIONS.find((item) => item.value === autoRefreshMs)?.label || '关闭',
    [autoRefreshMs],
  );
  const providerTabs = useMemo(() => {
    const rows = providers.length ? providers : fallbackProviders();
    return rows.map((item) => ({
      key: String(item.providerKey || item.key || '').trim(),
      name: item.name || item.providerKey || item.key || '--',
    })).filter((item) => item.key);
  }, [providers]);
  const flatCategoryTags = useMemo(() => buildFlatCategoryTags(searchableCategories), [searchableCategories]);

  const orderedItems = useMemo(() => sortItems(itemsPayload.items, sortMode), [itemsPayload.items, sortMode]);
  const heroItem = orderedItems[0] || null;
  const feedItems = heroItem ? orderedItems.slice(1) : [];
  const quickItems = orderedItems.slice(0, 8);
  const hotWords = useMemo(() => extractHotWords(orderedItems, 10), [orderedItems]);

  const categorySnapshot = useMemo(() => {
    const hit = new Map();
    (Array.isArray(itemsPayload?.items) ? itemsPayload.items : []).forEach((item) => {
      const key = String(item?.providerCategoryKey || '').trim() || 'unknown';
      hit.set(key, Number(hit.get(key) || 0) + 1);
    });
    return [...hit.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([key, count]) => ({
        categoryKey: key,
        name: categoryNameMap.get(key) || key,
        count,
      }));
  }, [itemsPayload?.items, categoryNameMap]);

  const canLoadMore = orderedItems.length < Number(itemsPayload?.total || 0);

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
      setItemDetail(null);
      if (!silent) setMessage(`资讯详情加载失败：${error.message || '未知错误'}`);
    } finally {
      if (!silent) setDetailLoading(false);
    }
  }

  async function openDetailDrawer(newsUid, { silent = false } = {}) {
    const uid = String(newsUid || '').trim();
    if (!uid) return;
    setDetailOpen(true);
    if (uid === selectedNewsUid && itemDetail?.newsUid === uid) {
      return;
    }
    await loadItemDetail(uid, { silent });
  }

  function closeDetailDrawer() {
    setDetailOpen(false);
  }

  async function loadItems({
    silent = false,
    append = false,
    targetPage = 1,
    nextProviderKey = providerKey,
    nextCategoryKey = itemCategoryKey,
    nextKeyword = itemKeyword,
  } = {}) {
    if (append) {
      setLoadingMore(true);
    } else if (!silent) {
      setLoading(true);
    }
    try {
      const payload = await clientApi.focusNews({
        providerKey: nextProviderKey,
        categoryKey: nextCategoryKey,
        q: String(nextKeyword || '').trim(),
        limit: PAGE_LIMIT,
        page: targetPage,
      });
      const nextPayload = toItemsPayload(payload);
      if (append) {
        setItemsPayload((prev) => ({
          ...nextPayload,
          items: mergeUniqueByUid(prev.items, nextPayload.items),
        }));
      } else {
        setItemsPayload(nextPayload);
      }
      setMessage('');
    } catch (error) {
      setMessage(`资讯查询失败：${error.message || '未知错误'}`);
    } finally {
      if (append) {
        setLoadingMore(false);
      } else if (!silent) {
        setLoading(false);
      }
    }
  }

  async function loadBootstrap({
    nextProviderKey = providerKey,
    nextCategoryKey = itemCategoryKey,
    nextKeyword = itemKeyword,
  } = {}) {
    setLoading(true);
    try {
      const [providersPayload, categoriesPayload] = await Promise.all([
        clientApi.focusNews.providers(),
        clientApi.focusNews.categories(),
      ]);

      const nextProviders = Array.isArray(providersPayload?.items) ? providersPayload.items : [];
      const nextCategories = Array.isArray(categoriesPayload?.items) ? categoriesPayload.items : [];
      const categoryRows = pickSearchableCategories(nextCategories);
      const categoryKeys = new Set(categoryRows.map((item) => item.categoryKey));
      const safeCategoryKey = categoryKeys.has(nextCategoryKey) ? nextCategoryKey : '';

      const itemsResponse = await clientApi.focusNews({
        providerKey: nextProviderKey,
        categoryKey: safeCategoryKey,
        q: String(nextKeyword || '').trim(),
        limit: PAGE_LIMIT,
        page: 1,
      });

      setProviders(nextProviders);
      setCategories(nextCategories);
      setItemCategoryKey(safeCategoryKey);
      setItemsPayload(toItemsPayload(itemsResponse));
      setMessage('');
    } catch (error) {
      setMessage(`资讯加载失败：${error.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBootstrap({
      nextProviderKey: '',
      nextCategoryKey: '',
      nextKeyword: '',
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!orderedItems.length) {
      setSelectedNewsUid('');
      setItemDetail(null);
      setDetailOpen(false);
      return;
    }
    if (!selectedNewsUid) return;
    const found = orderedItems.some((item) => item.newsUid === selectedNewsUid);
    if (!found) {
      setSelectedNewsUid('');
      setItemDetail(null);
      setDetailOpen(false);
    }
  }, [orderedItems, selectedNewsUid, itemDetail?.newsUid]);

  useEffect(() => {
    if (!autoRefreshMs || autoRefreshMs < 1000) return undefined;
    const timer = window.setInterval(() => {
      if (loading || loadingMore) return;
      loadItems({
        targetPage: 1,
        append: false,
        silent: true,
        nextProviderKey: providerKey,
        nextCategoryKey: itemCategoryKey,
        nextKeyword: itemKeyword,
      }).catch(() => {});
    }, autoRefreshMs);
    return () => window.clearInterval(timer);
  }, [autoRefreshMs, providerKey, itemCategoryKey, itemKeyword, loading, loadingMore]);

  useEffect(() => {
    if (!detailOpen) return undefined;

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        setDetailOpen(false);
      }
    }

    function onPointerDown(event) {
      const target = event.target;
      const drawer = detailDrawerRef.current;
      if (!(target instanceof Element) || !drawer) return;
      if (drawer.contains(target)) return;
      if (target.closest(DETAIL_TRIGGER_SELECTOR)) return;
      setDetailOpen(false);
    }

    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [detailOpen]);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-border/70">
        <CardHeader className="space-y-3 bg-gradient-to-r from-sky-100/35 via-cyan-100/20 to-transparent pb-4">
          <div className="space-y-0.5">
            <CardTitle className="text-sm font-semibold text-muted-foreground">资讯筛选</CardTitle>
            <CardDescription className="text-xs">默认展示全部来源、全部标签，按最新时间排序。</CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={itemKeyword}
                onChange={(event) => setItemKeyword(event.target.value)}
                placeholder="搜索标题、摘要、正文..."
                className="h-9 pl-8"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    loadItems({
                      targetPage: 1,
                      append: false,
                      silent: false,
                      nextProviderKey: providerKey,
                      nextCategoryKey: itemCategoryKey,
                      nextKeyword: itemKeyword,
                    }).catch(() => {});
                  }
                }}
              />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                onClick={() => loadItems({
                  targetPage: 1,
                  append: false,
                  silent: false,
                  nextProviderKey: providerKey,
                  nextCategoryKey: itemCategoryKey,
                  nextKeyword: itemKeyword,
                })}
                disabled={loading || loadingMore}
                className="h-9 px-4"
              >
                搜索
              </Button>

              <div className="inline-flex h-9 items-stretch overflow-hidden rounded-md border border-border/70 bg-background/70">
                <Button
                  size="sm"
                  variant={sortMode === 'latest' ? 'default' : 'ghost'}
                  onClick={() => setSortMode('latest')}
                  className="h-full rounded-none px-3 text-sm"
                >
                  最新优先
                </Button>
                <Button
                  size="sm"
                  variant={sortMode === 'hot' ? 'default' : 'ghost'}
                  onClick={() => setSortMode('hot')}
                  className="h-full rounded-none border-l border-border/70 px-3 text-sm"
                >
                  热度优先
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {providerTabs.map((item) => {
                const active = providerKey === item.key;
                return (
                  <Button
                    key={item.key}
                    type="button"
                    size="sm"
                    data-testid={`focus-news-provider-tab-${item.key}`}
                    variant={active ? 'default' : 'secondary'}
                    className="h-7 rounded-full px-3 text-xs"
                    onClick={() => {
                      const nextProviderKey = active ? '' : item.key;
                      setProviderKey(nextProviderKey);
                      loadItems({
                        targetPage: 1,
                        append: false,
                        silent: false,
                        nextProviderKey,
                        nextCategoryKey: itemCategoryKey,
                        nextKeyword: itemKeyword,
                      }).catch(() => {});
                    }}
                  >
                    来源 · {item.name}
                  </Button>
                );
              })}

              {flatCategoryTags.map((item) => {
                const active = itemCategoryKey === item.key;
                return (
                  <Button
                    key={item.key}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'secondary'}
                    className="h-7 rounded-full px-3 text-xs"
                    onClick={() => {
                      const nextCategoryKey = active ? '' : item.key;
                      setItemCategoryKey(nextCategoryKey);
                      loadItems({
                        targetPage: 1,
                        append: false,
                        silent: false,
                        nextProviderKey: providerKey,
                        nextCategoryKey,
                        nextKeyword: itemKeyword,
                      }).catch(() => {});
                    }}
                  >
                    标签 · {item.name}
                  </Button>
                );
              })}
            </div>
            {message ? <p className="text-xs text-destructive">{message}</p> : null}
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.5fr,0.78fr]">
        <div className="space-y-4">
          {heroItem ? (
            <Card className="border-border/70 bg-gradient-to-br from-card via-card to-sky-50/20">
              <CardHeader>
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="success" className="gap-1 px-2 py-0.5">
                    <TrendingUp className="size-3" />
                    头条
                  </Badge>
                  <span>{categoryNameMap.get(heroItem.providerCategoryKey) || heroItem.providerCategoryKey || '未分类'}</span>
                  <span>{formatRelativeTime(heroItem.publishedAt)}</span>
                </div>
                <button
                  type="button"
                  className="text-left"
                  data-testid="focus-news-hero-trigger"
                  data-focus-news-detail-trigger="true"
                  onClick={() => openDetailDrawer(heroItem.newsUid, { silent: false })}
                >
                  <h3 className="text-xl font-semibold leading-8 tracking-tight hover:text-primary">
                    {heroItem.title || '--'}
                  </h3>
                </button>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p className="line-clamp-4 leading-7">
                  {heroItem.summary || heroItem.content || '暂无摘要'}
                </p>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span>来源：{heroItem.sourceName || '--'}</span>
                  <span>发布时间：{formatDateTime(heroItem.publishedAt)}</span>
                  {Number(heroItem.hotScore || 0) > 0 ? <span>热度：{Number(heroItem.hotScore || 0).toFixed(0)}</span> : null}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1">
                  <CardTitle>资讯列表</CardTitle>
                  <CardDescription>滚动浏览信息流，点击任意条目即可从右侧展开详情。</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">自动刷新</span>
                  <Select
                    value={String(autoRefreshMs)}
                    onValueChange={(value) => {
                      const next = Number(value);
                      setAutoRefreshMs(Number.isFinite(next) ? next : 0);
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-[120px]"
                      data-testid="focus-news-auto-refresh-trigger"
                    >
                      {autoRefreshLabel}
                    </SelectTrigger>
                    <SelectContent position="popper" align="end" sideOffset={6}>
                      {AUTO_REFRESH_OPTIONS.map((item) => (
                        <SelectItem
                          key={item.value}
                          value={String(item.value)}
                          data-testid={`focus-news-auto-refresh-item-${item.value}`}
                        >
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-0 p-0">
              {!feedItems.length && !heroItem ? (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                  暂无匹配资讯，试试切换分类或关键词。
                </div>
              ) : null}
              {feedItems.map((item) => (
                <button
                  key={`${item.newsUid}-${item.id}`}
                  type="button"
                  data-testid={`focus-news-item-trigger-${item.newsUid}`}
                  data-focus-news-detail-trigger="true"
                  className={`block w-full border-t border-border/50 px-5 py-4 text-left transition-colors hover:bg-muted/25 ${
                    selectedNewsUid === item.newsUid ? 'bg-muted/30' : ''
                  }`}
                  onClick={() => openDetailDrawer(item.newsUid, { silent: false })}
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="px-2 py-0.5">
                      {categoryNameMap.get(item.providerCategoryKey) || item.providerCategoryKey || '未分类'}
                    </Badge>
                    <span>{formatRelativeTime(item.publishedAt)}</span>
                    <span>{item.sourceName || '--'}</span>
                  </div>
                  <h4 className="text-base font-semibold leading-7">{item.title || '--'}</h4>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {item.summary || item.content || '暂无摘要'}
                  </p>
                </button>
              ))}
              {canLoadMore ? (
                <div className="border-t border-border/50 p-4 text-center">
                  <Button
                    variant="secondary"
                    onClick={() => loadItems({
                      append: true,
                      targetPage: Number(itemsPayload.page || 1) + 1,
                      silent: true,
                      nextProviderKey: providerKey,
                      nextCategoryKey: itemCategoryKey,
                      nextKeyword: itemKeyword,
                    })}
                    disabled={loadingMore || loading}
                  >
                    {loadingMore ? '加载中...' : '加载更多'}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>最新快览</CardTitle>
              <CardDescription>快速扫一眼当前信息流。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {quickItems.map((item) => (
                <button
                  key={`quick-${item.newsUid}`}
                  type="button"
                  data-testid={`focus-news-quick-trigger-${item.newsUid}`}
                  data-focus-news-detail-trigger="true"
                  className={`block w-full rounded-lg border border-border/60 px-3 py-2 text-left transition-colors hover:bg-muted/20 ${
                    selectedNewsUid === item.newsUid ? 'bg-muted/25' : ''
                  }`}
                  onClick={() => openDetailDrawer(item.newsUid, { silent: false })}
                >
                  <p className="line-clamp-2 text-sm font-medium">{item.title || '--'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatRelativeTime(item.publishedAt)}</p>
                </button>
              ))}
              {!quickItems.length ? <p className="text-sm text-muted-foreground">暂无快览内容</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>热点雷达</CardTitle>
              <CardDescription>按当前结果聚合热词和分类热度。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-2 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <Flame className="size-3.5 text-orange-500" />
                  热点词
                </p>
                <div className="flex flex-wrap gap-2">
                  {hotWords.map((item) => (
                    <button
                      key={`kw-${item.word}`}
                      type="button"
                      className="rounded-full border border-border/60 bg-muted/20 px-2.5 py-1 text-xs hover:bg-muted/35"
                      onClick={() => {
                        setItemKeyword(item.word);
                        loadItems({
                          targetPage: 1,
                          append: false,
                          silent: false,
                          nextProviderKey: providerKey,
                          nextCategoryKey: itemCategoryKey,
                          nextKeyword: item.word,
                        }).catch(() => {});
                      }}
                    >
                      {item.word} · {item.count}
                    </button>
                  ))}
                  {!hotWords.length ? <p className="text-sm text-muted-foreground">暂无热词</p> : null}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">分类热度</p>
                {categorySnapshot.map((item) => {
                  const base = Number(categorySnapshot[0]?.count || 1);
                  const width = Math.max(10, Math.round((item.count / base) * 100));
                  return (
                    <button
                      key={`heat-${item.categoryKey}`}
                      type="button"
                      className="block w-full text-left"
                      onClick={() => {
                        setItemCategoryKey(item.categoryKey);
                        loadItems({
                          targetPage: 1,
                          append: false,
                          silent: false,
                          nextProviderKey: providerKey,
                          nextCategoryKey: item.categoryKey,
                          nextKeyword: itemKeyword,
                        }).catch(() => {});
                      }}
                    >
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="truncate">{item.name}</span>
                        <span className="text-muted-foreground">{item.count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted/40">
                        <div className="h-2 rounded-full bg-primary/70" style={{ width: `${width}%` }} />
                      </div>
                    </button>
                  );
                })}
                {!categorySnapshot.length ? <p className="text-sm text-muted-foreground">暂无分类热度数据</p> : null}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {detailOpen ? (
        <aside
          ref={detailDrawerRef}
          data-testid="focus-news-detail-drawer"
          role="dialog"
          aria-modal="false"
          style={{ width: 'min(620px, calc(100vw - 1rem))' }}
          className="fixed bottom-2 right-2 top-2 z-50 flex max-w-full flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl sm:bottom-3 sm:right-3 sm:top-3 lg:bottom-5 lg:right-5 lg:top-5"
        >
          <div className="border-b border-border/70 bg-gradient-to-b from-sky-50/70 to-background px-4 py-3 sm:px-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  资讯详情
                </p>
                {!detailLoading && itemDetail ? (
                  <>
                    <h3 className="mt-2 line-clamp-3 text-lg font-semibold leading-7 sm:text-xl" data-testid="focus-news-detail-title">
                      {itemDetail.title || '--'}
                    </h3>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span
                        className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/30 px-2 py-0.5 font-medium text-foreground"
                        data-testid="focus-news-detail-published-at"
                      >
                        <Clock3 className="size-3.5 text-sky-600" />
                        {formatDateTime(itemDetail.publishedAt)}
                      </span>
                      <Badge variant="outline" className="px-2 py-0.5">
                        {itemDetail.sourceName || '--'}
                      </Badge>
                      <Badge variant="outline" className="px-2 py-0.5">
                        {categoryNameMap.get(itemDetail.providerCategoryKey) || itemDetail.providerCategoryKey || '未分类'}
                      </Badge>
                      <span>{formatRelativeTime(itemDetail.publishedAt)}</span>
                    </div>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">正在加载资讯详情...</p>
                )}
              </div>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="size-9 shrink-0"
                data-testid="focus-news-detail-close"
                onClick={closeDetailDrawer}
                aria-label="关闭资讯详情"
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-auto px-4 py-4 sm:px-5 sm:py-5">
            {detailLoading ? (
              <p className="text-sm text-muted-foreground">详情加载中...</p>
            ) : null}
            {!detailLoading && !itemDetail ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/15 px-4 py-10 text-center text-sm text-muted-foreground">
                详情为空，请重新选择资讯。
              </div>
            ) : null}
            {!detailLoading && itemDetail ? (
              <div className="space-y-4">
                {itemDetail.summary ? (
                  <div className="rounded-xl border border-sky-100 bg-sky-50/60 px-4 py-3">
                    <p className="text-xs font-medium text-sky-900/70">摘要</p>
                    <p className="mt-1.5 text-sm leading-7 text-slate-700">{itemDetail.summary}</p>
                  </div>
                ) : null}

                <div className="rounded-xl border border-border/70 bg-background px-4 py-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">正文</p>
                    {itemDetail.url ? (
                      <a
                        href={itemDetail.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        打开原文
                        <ExternalLink className="size-3.5" />
                      </a>
                    ) : null}
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
                    {itemDetail.content || itemDetail.summary || '暂无正文'}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </aside>
      ) : null}
    </div>
  );
}

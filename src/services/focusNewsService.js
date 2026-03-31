import { createHash, randomUUID } from 'crypto';
import { normalizeSourceDateTime, sourceDayText } from '../../lib/focus-news-time.js';
import { HttpError } from '../utils/httpError.js';
import { focusNewsRepository } from '../repositories/focusNewsRepository.js';
import { newsProviderRegistry } from './newsProviderRegistry.js';

function normalizeProviderKey(input = '') {
  const key = String(input || '').trim();
  return key || 'tushare';
}

function nowIso() {
  return new Date().toISOString();
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function localDayText(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function normalizeDayText(input = '', fallback = '') {
  const text = String(input || '').trim();
  if (!text) return String(fallback || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new HttpError(400, `日期格式非法: ${text}，应为 YYYY-MM-DD`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    throw new HttpError(400, `日期无效: ${text}`);
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function sha256(text = '') {
  return createHash('sha256').update(String(text || '')).digest('hex');
}

function toText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function toNullableText(value) {
  const text = toText(value);
  return text || null;
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function collapseText(value, maxLength = 500) {
  const text = toText(value).replace(/\s+/g, ' ');
  if (!text) return '';
  return text.slice(0, maxLength);
}

function normalizeFingerprintText(value, maxLength = 420) {
  const text = collapseText(value, maxLength * 2)
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\[\]【】()（）{}<>《》"'`“”‘’:：;,，.。!！?？、/\\|+\-_=~^*&%$#@]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^0-9a-z\u4e00-\u9fa5 ]+/gi, '')
    .trim();
  return text.slice(0, maxLength);
}

function pickPublishedAtCandidate(item = {}) {
  return (
    item.publishedAt
    || item.datetime
    || item.pub_time
    || item.ann_date
    || item.end_date
    || item.date
    || item.created_at
    || item.createdAt
    || item.published_at
    || item.time
  );
}

function normalizeItemForStorage(item = {}, { providerKey = '', fallbackCategoryKey = '' } = {}) {
  const provider = toText(item.provider || providerKey) || providerKey;
  const providerCategoryKey = toText(item.providerCategoryKey || fallbackCategoryKey) || fallbackCategoryKey;

  const title = collapseText(
    item.title
    || item.name
    || item.content
    || item.summary
    || '无标题',
    400,
  ) || '无标题';
  const summary = collapseText(item.summary, 1200);
  const content = collapseText(item.content, 8000);
  const canonicalTitle = collapseText(title.toLowerCase(), 200);
  const titleFingerprint = normalizeFingerprintText(title, 240);
  const bodyFingerprint = normalizeFingerprintText(summary || content, 420);
  const publishedAt = normalizeSourceDateTime(pickPublishedAtCandidate(item));
  const publishedDay = publishedAt ? sourceDayText(publishedAt) : '';
  const sourceName = toNullableText(item.sourceName || item.source || item.src || provider);

  const dedupeSeed = [
    provider,
    providerCategoryKey,
    titleFingerprint || canonicalTitle,
    bodyFingerprint,
    publishedDay,
  ].join('|');
  const dedupeFingerprint = sha256(dedupeSeed);
  const eventFingerprint = sha256([
    titleFingerprint || canonicalTitle,
    bodyFingerprint,
    publishedDay,
  ].join('|'));

  let providerItemId = toNullableText(
    item.providerItemId
    || item.newsId
    || item.news_id
    || item.id
    || item.ts_code,
  );
  if (!providerItemId) {
    providerItemId = `${providerCategoryKey || 'news'}:${dedupeFingerprint.slice(0, 20)}:${publishedDay || 'unknown'}`;
  }

  const newsUid = sha256([
    provider,
    providerItemId || dedupeFingerprint,
    publishedAt || '',
  ].join('|'));

  const meta = {
    raw: item.meta || item,
    primaryProviderKey: provider,
    primaryProviderItemId: providerItemId,
    sourceProviders: [provider],
    sourceNames: sourceName ? [sourceName] : [],
    sourceRecords: [
      {
        providerKey: provider,
        providerItemId,
        providerCategoryKey: providerCategoryKey || null,
        sourceName: sourceName || null,
        url: toNullableText(item.url),
        publishedAt: publishedAt || null,
      },
    ],
    mergedSourceCount: 1,
  };

  return {
    newsUid,
    providerKey: provider,
    providerItemId,
    providerCategoryKey: providerCategoryKey || null,
    canonicalTitle: canonicalTitle || null,
    title,
    summary: summary || null,
    content: content || null,
    url: toNullableText(item.url),
    sourceName,
    author: toNullableText(item.author),
    lang: toNullableText(item.lang || 'zh-CN'),
    region: toNullableText(item.region || 'CN'),
    importanceScore: toNumber(item.importanceScore, 0),
    hotScore: toNumber(item.hotScore, 0),
    dedupeFingerprint,
    eventFingerprint,
    publishedAt,
    meta,
  };
}

function toInternalTaxonomyKey(providerKey, categoryKey) {
  return `provider.${providerKey}.${categoryKey}`;
}

function toInternalParentTaxonomyKey(providerKey, category = {}) {
  const parent = String(category.parentCategoryKey || '').trim();
  if (!parent) return 'news.root';
  return toInternalTaxonomyKey(providerKey, parent);
}

function toCatalogTaxonomy(providerKey, category = {}) {
  const key = toInternalTaxonomyKey(providerKey, category.categoryKey);
  const parent = toInternalParentTaxonomyKey(providerKey, category);
  return {
    taxonomyKey: key,
    parentTaxonomyKey: parent,
    name: category.name,
    level: Math.max(2, Number(category.level || 1) + 1),
    sortOrder: Number(category.sortOrder || 100),
    isActive: category.isActive !== false,
    description: `[${providerKey}] 分类映射`,
    meta: {
      providerKey,
      providerCategoryKey: category.categoryKey,
      providerParentCategoryKey: category.parentCategoryKey || null,
    },
  };
}

function toAutoMapping(providerKey, category = {}) {
  return {
    providerKey,
    providerCategoryKey: category.categoryKey,
    taxonomyKey: toInternalTaxonomyKey(providerKey, category.categoryKey),
    mappingType: 'auto',
    confidence: 0.75,
    isManual: false,
  };
}

export const focusNewsService = {
  listProviders() {
    const registered = newsProviderRegistry.list();
    const stored = focusNewsRepository.listProviders();
    const storedMap = new Map(stored.map((item) => [item.providerKey, item]));

    return registered.map((item, index) => {
      const existing = storedMap.get(item.key);
      return existing || {
        providerKey: item.key,
        name: item.name,
        enabled: true,
        priority: (index + 1) * 10,
        config: {},
        createdAt: null,
        updatedAt: null,
      };
    });
  },

  listProviderCategories(payload = {}) {
    const providerKey = String(payload.providerKey || '').trim();
    return focusNewsRepository.listProviderCategories({ providerKey });
  },

  listTaxonomies() {
    return focusNewsRepository.listTaxonomies();
  },

  listTaxonomyMappings(payload = {}) {
    const providerKey = String(payload.providerKey || '').trim();
    return focusNewsRepository.listTaxonomyMappings({ providerKey });
  },

  listSyncRuns(payload = {}) {
    const providerKey = String(payload.providerKey || '').trim();
    const limit = Number(payload.limit || 50);
    const triggerType = String(payload.triggerType || '').trim();
    const status = String(payload.status || '').trim();
    return focusNewsRepository.listSyncRuns({
      providerKey,
      limit,
      triggerType,
      status,
    });
  },

  listItems(payload = {}) {
    return focusNewsRepository.listNewsItems({
      providerKey: String(payload.providerKey || '').trim(),
      categoryKey: String(payload.categoryKey || '').trim(),
      q: String(payload.q || '').trim(),
      page: payload.page,
      limit: payload.limit,
    });
  },

  getItemDetail(payload = {}) {
    const item = focusNewsRepository.getNewsItemDetail({
      newsUid: String(payload.newsUid || '').trim(),
      id: payload.id,
    });
    if (!item) {
      throw new HttpError(404, '资讯详情不存在');
    }
    return item;
  },

  async syncCatalog(payload = {}) {
    const providerKey = normalizeProviderKey(payload.providerKey);
    const triggerType = String(payload.triggerType || 'manual').trim() || 'manual';
    const provider = newsProviderRegistry.get(providerKey);
    if (!provider) {
      throw new HttpError(404, `资讯 provider 不存在: ${providerKey}`);
    }

    focusNewsRepository.upsertProvider({
      providerKey,
      name: provider.getDisplayName(),
      enabled: true,
      priority: 10,
      config: {},
    });

    const runId = randomUUID();
    focusNewsRepository.createSyncRun({
      runId,
      providerKey,
      triggerType,
      status: 'running',
      syncMode: 'catalog',
      startedAt: nowIso(),
      stats: { stage: 'bootstrap' },
    });

    try {
      const sourceCategories = await provider.pullCatalog();
      const categories = sourceCategories.map((item) => provider.normalizeCategory(item));
      const savedCategories = focusNewsRepository.replaceProviderCategories(providerKey, categories);

      const taxonomyItems = categories.map((item) => toCatalogTaxonomy(providerKey, item));
      const mappingItems = categories.map((item) => toAutoMapping(providerKey, item));
      focusNewsRepository.upsertTaxonomies(taxonomyItems);
      focusNewsRepository.upsertTaxonomyMappings(mappingItems);

      const completed = focusNewsRepository.updateSyncRun(runId, {
        status: 'completed',
        finishedAt: nowIso(),
        rawCount: sourceCategories.length,
        normalizedCount: categories.length,
        insertedCount: savedCategories.filter((item) => item.isActive).length,
        updatedCount: 0,
        dedupedCount: 0,
        failedCount: 0,
        stats: {
          categoryCount: categories.length,
          taxonomyCount: taxonomyItems.length,
          mappingCount: mappingItems.length,
        },
      });

      return {
        run: completed,
        provider: focusNewsRepository.getProvider(providerKey),
        categories: savedCategories,
      };
    } catch (error) {
      const failed = focusNewsRepository.updateSyncRun(runId, {
        status: 'failed',
        finishedAt: nowIso(),
        failedCount: 1,
        errorMessage: error.message || '同步失败',
        stats: { stage: 'failed' },
      });
      throw new HttpError(502, `资讯分类同步失败: ${error.message || '未知错误'}`, {
        runId: failed?.runId || runId,
        providerKey,
      });
    }
  },

  async syncItems(payload = {}) {
    const providerKey = normalizeProviderKey(payload.providerKey);
    const categoryKey = String(payload.categoryKey || 'news').trim() || 'news';
    const triggerType = String(payload.triggerType || 'manual').trim() || 'manual';
    const today = localDayText();
    const startDate = normalizeDayText(payload.startDate || today, today);
    const endDate = normalizeDayText(payload.endDate || startDate, startDate);
    if (startDate > endDate) {
      throw new HttpError(400, `时间窗口非法: startDate ${startDate} 大于 endDate ${endDate}`);
    }

    const provider = newsProviderRegistry.get(providerKey);
    if (!provider) {
      throw new HttpError(404, `资讯 provider 不存在: ${providerKey}`);
    }

    const limitRaw = Number(payload.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 5000)) : 500;
    const runId = randomUUID();
    focusNewsRepository.createSyncRun({
      runId,
      providerKey,
      categoryKey,
      triggerType,
      status: 'running',
      syncMode: 'items',
      windowStart: startDate,
      windowEnd: endDate,
      startedAt: nowIso(),
      stats: {
        stage: 'pulling',
        categoryKey,
      },
    });

    try {
      const sourceItems = await provider.pullItems({
        providerKey,
        categoryKey,
        startDate,
        endDate,
        limit,
        webCookie: String(payload.webCookie || '').trim(),
        newsSources: payload.newsSources,
      });
      const rows = Array.isArray(sourceItems) ? sourceItems : [];
      const rawCount = rows.length;

      const rawInserted = focusNewsRepository.insertRawItems({
        runId,
        providerKey,
        categoryKey,
        items: rows.map((item) => ({
          ...item,
          providerKey,
          providerCategoryKey: item?.providerCategoryKey || categoryKey,
          publishedAt: pickPublishedAtCandidate(item),
        })),
      });

      const normalizedItems = [];
      let normalizeFailed = 0;
      rows.forEach((item) => {
        try {
          const normalized = normalizeItemForStorage(item, {
            providerKey,
            fallbackCategoryKey: categoryKey,
          });
          if (!normalized?.newsUid || !normalized?.title) {
            normalizeFailed += 1;
            return;
          }
          normalizedItems.push(normalized);
        } catch {
          normalizeFailed += 1;
        }
      });

      const upsertStats = focusNewsRepository.upsertNewsItems(normalizedItems);
      const failedCount = Number(normalizeFailed) + Number(upsertStats.failed || 0);
      const completed = focusNewsRepository.updateSyncRun(runId, {
        status: 'completed',
        finishedAt: nowIso(),
        rawCount,
        normalizedCount: normalizedItems.length,
        insertedCount: upsertStats.inserted || 0,
        updatedCount: upsertStats.updated || 0,
        dedupedCount: upsertStats.deduped || 0,
        failedCount,
        stats: {
          categoryKey,
          rawInserted,
          normalizeFailed,
          storageFailed: upsertStats.failed || 0,
          window: {
            startDate,
            endDate,
          },
        },
      });

      return {
        run: completed,
        provider: focusNewsRepository.getProvider(providerKey),
        categoryKey,
        window: {
          startDate,
          endDate,
        },
        result: {
          rawCount,
          rawInserted,
          normalizedCount: normalizedItems.length,
          insertedCount: upsertStats.inserted || 0,
          updatedCount: upsertStats.updated || 0,
          dedupedCount: upsertStats.deduped || 0,
          failedCount,
        },
      };
    } catch (error) {
      const failed = focusNewsRepository.updateSyncRun(runId, {
        status: 'failed',
        finishedAt: nowIso(),
        failedCount: 1,
        errorMessage: error.message || '同步失败',
        stats: {
          stage: 'failed',
          categoryKey,
          window: {
            startDate,
            endDate,
          },
        },
      });
      throw new HttpError(502, `资讯条目同步失败: ${error.message || '未知错误'}`, {
        runId: failed?.runId || runId,
        providerKey,
        categoryKey,
      });
    }
  },
};

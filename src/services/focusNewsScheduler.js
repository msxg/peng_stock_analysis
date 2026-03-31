import { focusNewsRepository } from '../repositories/focusNewsRepository.js';
import { systemRepository } from '../repositories/systemRepository.js';
import { focusNewsService } from './focusNewsService.js';
import { newsProviderRegistry } from './newsProviderRegistry.js';

const DEFAULT_PROVIDER_KEY = 'tushare';
const runtimes = new Map();

function toBool(value, fallback = false) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return Boolean(fallback);
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return Boolean(fallback);
}

function toInt(value, fallback = 0, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(num)));
}

function readBoolConfig(key, fallback = false) {
  return toBool(systemRepository.getConfigValue(key), fallback);
}

function readIntConfig(key, fallback = 0, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  return toInt(systemRepository.getConfigValue(key), fallback, min, max);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toLocalDayText(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function buildRetryKey(providerKey, categoryKey) {
  return `${String(providerKey || '').trim()}:${String(categoryKey || '').trim()}`;
}

function normalizeProviderKey(input) {
  if (typeof input === 'string') {
    const key = String(input || '').trim();
    return key || DEFAULT_PROVIDER_KEY;
  }
  const key = String(input?.providerKey || '').trim();
  return key || DEFAULT_PROVIDER_KEY;
}

function toProviderConfigSuffix(providerKey = '') {
  return String(providerKey || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toUpperCase();
}

function listRegisteredProviderKeys() {
  const keys = newsProviderRegistry.list().map((item) => String(item.key || '').trim()).filter(Boolean);
  if (!keys.length) return [DEFAULT_PROVIDER_KEY];
  if (!keys.includes(DEFAULT_PROVIDER_KEY)) {
    keys.unshift(DEFAULT_PROVIDER_KEY);
  }
  return [...new Set(keys)];
}

function createRuntime(providerKey) {
  return {
    providerKey,
    timer: null,
    firstTickTimer: null,
    started: false,
    running: false,
    roundRobinCursor: 0,
    lastCatalogSyncAt: 0,
    lastTickAt: '',
    lastTickResult: null,
    stateLoadedAt: '',
    statePersistedAt: '',
    stateRestored: false,
    retryState: new Map(),
  };
}

function getRuntime(providerKey, { create = true } = {}) {
  const key = normalizeProviderKey(providerKey);
  const existing = runtimes.get(key);
  if (existing || !create) return existing || null;
  const runtime = createRuntime(key);
  runtimes.set(key, runtime);
  return runtime;
}

function resetRuntimeState(runtime) {
  runtime.roundRobinCursor = 0;
  runtime.lastCatalogSyncAt = 0;
  runtime.lastTickAt = '';
  runtime.lastTickResult = null;
  runtime.stateLoadedAt = new Date().toISOString();
  runtime.stateRestored = false;
  runtime.retryState.clear();
}

function snapshotRetryState(runtime) {
  const payload = {};
  Array.from(runtime.retryState.entries()).forEach(([key, item]) => {
    payload[key] = {
      attempts: toInt(item?.attempts, 0, 0, 1000),
      nextAt: toInt(item?.nextAt, 0, 0, Number.MAX_SAFE_INTEGER),
      lastError: String(item?.lastError || ''),
      updatedAt: String(item?.updatedAt || ''),
    };
  });
  return payload;
}

function restoreRetryState(runtime, payload = {}) {
  runtime.retryState.clear();
  if (!payload || typeof payload !== 'object') return;
  Object.entries(payload).forEach(([key, item]) => {
    const retryKey = String(key || '').trim();
    if (!retryKey) return;
    runtime.retryState.set(retryKey, {
      attempts: toInt(item?.attempts, 0, 0, 1000),
      nextAt: toInt(item?.nextAt, 0, 0, Number.MAX_SAFE_INTEGER),
      lastError: String(item?.lastError || ''),
      updatedAt: String(item?.updatedAt || ''),
    });
  });
}

function loadPersistedState(runtime) {
  resetRuntimeState(runtime);
  try {
    const persisted = focusNewsRepository.getSchedulerState({ providerKey: runtime.providerKey });
    if (!persisted) return null;

    runtime.roundRobinCursor = toInt(persisted.roundRobinCursor, 0, 0, Number.MAX_SAFE_INTEGER);
    runtime.lastCatalogSyncAt = toInt(persisted.lastCatalogSyncAt, 0, 0, Number.MAX_SAFE_INTEGER);
    runtime.lastTickAt = String(persisted.lastTickAt || '').trim();
    runtime.lastTickResult = persisted.lastResult && typeof persisted.lastResult === 'object'
      ? persisted.lastResult
      : null;
    restoreRetryState(runtime, persisted.retryState || {});
    runtime.statePersistedAt = String(persisted.updatedAt || '').trim();
    runtime.stateRestored = true;
    return persisted;
  } catch (error) {
    console.error(`[focus-news][scheduler] load persisted state failed provider=${runtime.providerKey}: ${error?.message || 'unknown error'}`);
    return null;
  }
}

function persistState(runtime) {
  try {
    const payload = focusNewsRepository.upsertSchedulerState({
      providerKey: runtime.providerKey,
      roundRobinCursor: runtime.roundRobinCursor,
      lastCatalogSyncAt: runtime.lastCatalogSyncAt,
      retryState: snapshotRetryState(runtime),
      lastTickAt: runtime.lastTickAt || null,
      lastResult: runtime.lastTickResult || null,
    });
    runtime.statePersistedAt = String(payload?.updatedAt || '').trim() || new Date().toISOString();
    return payload;
  } catch (error) {
    console.error(`[focus-news][scheduler] persist state failed provider=${runtime.providerKey}: ${error?.message || 'unknown error'}`);
    return null;
  }
}

function listSyncCategories(providerKey = DEFAULT_PROVIDER_KEY) {
  return focusNewsRepository
    .listProviderCategories({ providerKey })
    .filter(
      (item) => item.isActive
        && item.schedulerEnabled !== false
        && Number(item.level || 0) >= 2
        && item.categoryKey,
    );
}

function toSchedulerPriority(item = {}) {
  if (Number.isFinite(Number(item.schedulerPriority))) {
    return Math.max(1, Math.trunc(Number(item.schedulerPriority)));
  }
  if (Number.isFinite(Number(item.sortOrder))) {
    return Math.max(1, Math.trunc(Number(item.sortOrder)));
  }
  return 100;
}

function sortSchedulerCategories(items = []) {
  return [...items].sort((a, b) => {
    const byPriority = toSchedulerPriority(a) - toSchedulerPriority(b);
    if (byPriority !== 0) return byPriority;
    const bySortOrder = toInt(a.sortOrder, 100, 1, 999999) - toInt(b.sortOrder, 100, 1, 999999);
    if (bySortOrder !== 0) return bySortOrder;
    const byLevel = toInt(a.level, 0, 0, 99) - toInt(b.level, 0, 0, 99);
    if (byLevel !== 0) return byLevel;
    return String(a.categoryKey || '').localeCompare(String(b.categoryKey || ''));
  });
}

function pickRoundRobinCategories(runtime, categories = [], limit = 1, excludeKeys = new Set()) {
  const pool = sortSchedulerCategories(categories).filter((item) => !excludeKeys.has(item.categoryKey));
  if (!pool.length || limit <= 0) return [];

  const picks = [];
  let index = runtime.roundRobinCursor % pool.length;
  let visited = 0;
  while (visited < pool.length && picks.length < limit) {
    const candidate = pool[index];
    if (candidate?.categoryKey) {
      picks.push({
        category: candidate,
        isRetry: false,
        retry: null,
      });
    }
    visited += 1;
    index = (index + 1) % pool.length;
  }
  runtime.roundRobinCursor = index;
  return picks;
}

function pickNextCategories(runtime, categories = [], limit = 1) {
  if (!categories.length || limit <= 0) return [];
  const safeLimit = Math.max(1, Math.trunc(Number(limit) || 1));
  const now = Date.now();
  const selected = [];
  const selectedKeys = new Set();

  const retryCandidates = categories
    .map((category) => {
      const key = buildRetryKey(category.providerKey || runtime.providerKey, category.categoryKey);
      const retry = runtime.retryState.get(key);
      if (!retry) return null;
      if (retry.nextAt > now) return null;
      return { category, retry };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const byNextAt = toInt(a.retry?.nextAt, 0, 0, Number.MAX_SAFE_INTEGER)
        - toInt(b.retry?.nextAt, 0, 0, Number.MAX_SAFE_INTEGER);
      if (byNextAt !== 0) return byNextAt;
      return toSchedulerPriority(a.category) - toSchedulerPriority(b.category);
    });

  for (const item of retryCandidates) {
    if (selected.length >= safeLimit) break;
    const key = String(item?.category?.categoryKey || '').trim();
    if (!key || selectedKeys.has(key)) continue;
    selected.push({
      category: item.category,
      isRetry: true,
      retry: item.retry,
    });
    selectedKeys.add(key);
  }

  if (selected.length < safeLimit) {
    const roundRobin = pickRoundRobinCategories(
      runtime,
      categories,
      safeLimit - selected.length,
      selectedKeys,
    );
    roundRobin.forEach((item) => {
      const key = String(item?.category?.categoryKey || '').trim();
      if (!key || selectedKeys.has(key)) return;
      selected.push(item);
      selectedKeys.add(key);
    });
  }
  return selected;
}

function markRetry(runtime, providerKey, categoryKey, errorMessage = '', maxRetry = 3, baseDelaySeconds = 60) {
  const key = buildRetryKey(providerKey, categoryKey);
  const previous = runtime.retryState.get(key) || { attempts: 0 };
  const attempts = Math.min(previous.attempts + 1, Math.max(1, maxRetry));
  const delaySeconds = baseDelaySeconds * Math.pow(2, Math.max(0, attempts - 1));
  runtime.retryState.set(key, {
    attempts,
    nextAt: Date.now() + (delaySeconds * 1000),
    lastError: String(errorMessage || ''),
    updatedAt: new Date().toISOString(),
  });
}

function clearRetry(runtime, providerKey, categoryKey) {
  const key = buildRetryKey(providerKey, categoryKey);
  runtime.retryState.delete(key);
}

async function ensureCatalogFresh(runtime) {
  const refreshMinutes = readIntConfig('NEWS_SYNC_CATALOG_REFRESH_MINUTES', 360, 10, 24 * 60);
  const shouldRefresh = (
    listSyncCategories(runtime.providerKey).length === 0
    || (Date.now() - runtime.lastCatalogSyncAt) >= refreshMinutes * 60 * 1000
  );
  if (!shouldRefresh) return false;

  await focusNewsService.syncCatalog({
    providerKey: runtime.providerKey,
    triggerType: 'scheduler',
  });
  runtime.lastCatalogSyncAt = Date.now();
  return true;
}

async function runCycle(runtime) {
  const providerKey = runtime.providerKey;
  const result = {
    providerKey,
    reason: '',
    runStatus: 'idle',
    attemptedCount: 0,
    completedCount: 0,
    failedCount: 0,
    schedulerConcurrency: 1,
    selectedCategoryKey: '',
    selectedCategoryKeys: [],
    isRetry: false,
    catalogRefreshed: false,
    errorMessage: '',
    errors: [],
  };

  const enabled = readBoolConfig('NEWS_SYNC_ENABLED', true);
  if (!enabled) {
    result.reason = 'sync_disabled';
    return result;
  }

  const configSuffix = toProviderConfigSuffix(providerKey);
  const providerEnabled = readBoolConfig(`NEWS_PROVIDER_${configSuffix}_ENABLED`, true);
  if (!providerEnabled) {
    result.reason = 'provider_disabled';
    return result;
  }

  result.catalogRefreshed = await ensureCatalogFresh(runtime);
  const categories = listSyncCategories(providerKey);
  if (!categories.length) {
    result.reason = 'no_active_categories';
    return result;
  }

  const schedulerConcurrency = readIntConfig('NEWS_SCHEDULER_CONCURRENCY', 1, 1, 8);
  result.schedulerConcurrency = schedulerConcurrency;
  const selectedEntries = pickNextCategories(runtime, categories, schedulerConcurrency);
  if (!selectedEntries.length) {
    result.reason = 'no_selected_category';
    return result;
  }

  const lookbackMinutes = readIntConfig('NEWS_SYNC_LOOKBACK_MINUTES', 180, 1, 7 * 24 * 60);
  const maxItems = readIntConfig('NEWS_MAX_ITEMS_PER_RUN', 1000, 1, 5000);
  const retryMax = readIntConfig('NEWS_SYNC_RETRY_MAX', 3, 1, 10);
  const retryBaseSeconds = readIntConfig('NEWS_SYNC_RETRY_BASE_SECONDS', 60, 10, 3600);

  const now = new Date();
  const start = new Date(now.getTime() - lookbackMinutes * 60 * 1000);
  const startDate = toLocalDayText(start);
  const endDate = toLocalDayText(now);
  result.selectedCategoryKeys = selectedEntries.map((item) => item.category?.categoryKey).filter(Boolean);
  result.selectedCategoryKey = result.selectedCategoryKeys[0] || '';
  result.isRetry = selectedEntries.some((item) => item.isRetry === true);

  const tasks = selectedEntries.map(async (entry) => {
    const categoryKey = String(entry?.category?.categoryKey || '').trim();
    if (!categoryKey) {
      return {
        categoryKey: '',
        status: 'failed',
        isRetry: entry?.isRetry === true,
        errorMessage: 'empty category key',
      };
    }

    try {
      await focusNewsService.syncItems({
        providerKey,
        categoryKey,
        startDate,
        endDate,
        limit: maxItems,
        triggerType: 'scheduler',
      });
      clearRetry(runtime, providerKey, categoryKey);
      return {
        categoryKey,
        status: 'completed',
        isRetry: entry?.isRetry === true,
        errorMessage: '',
      };
    } catch (error) {
      const message = String(error?.message || 'scheduler sync failed');
      markRetry(runtime, providerKey, categoryKey, message, retryMax, retryBaseSeconds);
      console.error(`[focus-news][scheduler] sync failed provider=${providerKey} category=${categoryKey}: ${message}`);
      return {
        categoryKey,
        status: 'failed',
        isRetry: entry?.isRetry === true,
        errorMessage: message,
      };
    }
  });

  const taskResults = await Promise.all(tasks);
  result.attemptedCount = taskResults.length;
  result.completedCount = taskResults.filter((item) => item.status === 'completed').length;
  result.failedCount = taskResults.filter((item) => item.status === 'failed').length;
  result.errors = taskResults
    .filter((item) => item.status === 'failed' && item.errorMessage)
    .map((item) => ({
      categoryKey: item.categoryKey,
      errorMessage: item.errorMessage,
    }));

  if (result.failedCount === 0) {
    result.runStatus = 'completed';
  } else if (result.completedCount > 0) {
    result.runStatus = 'partial_failed';
    result.reason = 'sync_partial_failed';
    result.errorMessage = `${result.failedCount}/${result.attemptedCount} 分类采集失败`;
  } else {
    result.runStatus = 'failed';
    result.reason = 'sync_failed';
    result.errorMessage = `${result.failedCount}/${result.attemptedCount} 分类采集失败`;
  }
  return result;
}

async function tick({ providerKey = DEFAULT_PROVIDER_KEY } = {}) {
  const runtime = getRuntime(providerKey);
  const key = runtime.providerKey;
  if (runtime.running) {
    runtime.lastTickAt = new Date().toISOString();
    runtime.lastTickResult = {
      skipped: true,
      reason: 'scheduler_is_running',
      providerKey: key,
      runStatus: 'skipped',
      attemptedCount: 0,
      completedCount: 0,
      failedCount: 0,
      schedulerConcurrency: 0,
      selectedCategoryKey: '',
      selectedCategoryKeys: [],
      isRetry: false,
      catalogRefreshed: false,
      durationMs: 0,
      errorMessage: '',
      errors: [],
    };
    persistState(runtime);
    return {
      ...runtime.lastTickResult,
    };
  }

  runtime.running = true;
  const beginAt = Date.now();
  try {
    const cycleResult = await runCycle(runtime);
    runtime.lastTickAt = new Date().toISOString();
    runtime.lastTickResult = {
      skipped: false,
      reason: cycleResult.reason || '',
      providerKey: key,
      runStatus: cycleResult.runStatus || 'idle',
      attemptedCount: cycleResult.attemptedCount || 0,
      completedCount: cycleResult.completedCount || 0,
      failedCount: cycleResult.failedCount || 0,
      schedulerConcurrency: cycleResult.schedulerConcurrency || 1,
      selectedCategoryKey: cycleResult.selectedCategoryKey || '',
      selectedCategoryKeys: Array.isArray(cycleResult.selectedCategoryKeys)
        ? cycleResult.selectedCategoryKeys
        : [],
      isRetry: cycleResult.isRetry === true,
      catalogRefreshed: cycleResult.catalogRefreshed === true,
      durationMs: Math.max(0, Date.now() - beginAt),
      errorMessage: cycleResult.errorMessage || '',
      errors: Array.isArray(cycleResult.errors) ? cycleResult.errors : [],
    };
    persistState(runtime);
    return {
      ...runtime.lastTickResult,
    };
  } catch (error) {
    runtime.lastTickAt = new Date().toISOString();
    runtime.lastTickResult = {
      skipped: false,
      reason: 'tick_exception',
      providerKey: key,
      runStatus: 'failed',
      attemptedCount: 0,
      completedCount: 0,
      failedCount: 0,
      schedulerConcurrency: 1,
      selectedCategoryKey: '',
      selectedCategoryKeys: [],
      isRetry: false,
      catalogRefreshed: false,
      durationMs: Math.max(0, Date.now() - beginAt),
      errorMessage: String(error?.message || 'unknown error'),
      errors: [],
    };
    persistState(runtime);
    throw error;
  } finally {
    runtime.running = false;
  }
}

function resolveProviderKeys(options = {}) {
  if (typeof options === 'string') {
    return [normalizeProviderKey(options)];
  }
  if (options?.providerKey) {
    return [normalizeProviderKey(options.providerKey)];
  }
  return listRegisteredProviderKeys();
}

function startProvider(providerKey) {
  const runtime = getRuntime(providerKey);
  if (runtime.started) return runtime;

  loadPersistedState(runtime);
  persistState(runtime);

  runtime.started = true;
  const tickSeconds = readIntConfig('NEWS_SYNC_TICK_SECONDS', 60, 10, 3600);
  runtime.timer = setInterval(() => {
    tick({ providerKey: runtime.providerKey }).catch((error) => {
      console.error(`[focus-news][scheduler] tick failed provider=${runtime.providerKey}: ${error?.message || 'unknown error'}`);
    });
  }, tickSeconds * 1000);
  if (typeof runtime.timer.unref === 'function') runtime.timer.unref();

  runtime.firstTickTimer = setTimeout(() => {
    runtime.firstTickTimer = null;
    tick({ providerKey: runtime.providerKey }).catch((error) => {
      console.error(`[focus-news][scheduler] first tick failed provider=${runtime.providerKey}: ${error?.message || 'unknown error'}`);
    });
  }, 3000);

  console.log(`[focus-news][scheduler] started, provider=${runtime.providerKey}, tick=${tickSeconds}s`);
  return runtime;
}

function stopProvider(providerKey) {
  const runtime = getRuntime(providerKey, { create: false });
  if (!runtime) return;

  if (runtime.timer) {
    clearInterval(runtime.timer);
    runtime.timer = null;
  }
  if (runtime.firstTickTimer) {
    clearTimeout(runtime.firstTickTimer);
    runtime.firstTickTimer = null;
  }

  runtime.started = false;
  runtime.running = false;
  persistState(runtime);
}

function toStatus(runtime) {
  const activeCategories = listSyncCategories(runtime.providerKey);
  return {
    providerKey: runtime.providerKey,
    started: runtime.started === true,
    running: runtime.running === true,
    schedulerConcurrency: readIntConfig('NEWS_SCHEDULER_CONCURRENCY', 1, 1, 8),
    activeCategoryCount: activeCategories.length,
    roundRobinCursor: runtime.roundRobinCursor,
    lastCatalogSyncAt: runtime.lastCatalogSyncAt,
    lastCatalogSyncAtText: runtime.lastCatalogSyncAt ? new Date(runtime.lastCatalogSyncAt).toISOString() : null,
    lastTickAt: runtime.lastTickAt || null,
    lastTickResult: runtime.lastTickResult,
    stateRestored: runtime.stateRestored === true,
    stateLoadedAt: runtime.stateLoadedAt || null,
    statePersistedAt: runtime.statePersistedAt || null,
    retryQueueSize: runtime.retryState.size,
    retries: Array.from(runtime.retryState.entries()).map(([key, value]) => ({
      key,
      ...value,
    })),
  };
}

export const focusNewsScheduler = {
  start(options = {}) {
    resolveProviderKeys(options).forEach((providerKey) => {
      startProvider(providerKey);
    });
  },

  stop(options = {}) {
    resolveProviderKeys(options).forEach((providerKey) => {
      stopProvider(providerKey);
    });
  },

  getStatus(options = {}) {
    const providerKey = normalizeProviderKey(options);
    const runtime = getRuntime(providerKey, { create: false }) || createRuntime(providerKey);
    return toStatus(runtime);
  },

  async runNow(options = {}) {
    const providerKey = normalizeProviderKey(options);
    startProvider(providerKey);
    const result = await tick({ providerKey });
    return {
      ...result,
      status: this.getStatus({ providerKey }),
    };
  },
};

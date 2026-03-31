import { createHash } from 'crypto';
import { normalizeSourceDateTime } from '../../lib/focus-news-time.js';
import { getDb } from '../db/database.js';

function parseJson(text, fallback = null) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function stringifyJson(value, fallback = '{}') {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return fallback;
  }
}

function sha256(text = '') {
  return createHash('sha256').update(String(text || '')).digest('hex');
}

function toNullableText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function toText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

function toRawItemInput(item = {}, fallback = {}) {
  const payload = item.rawPayload ?? item.meta ?? item;
  const payloadJson = stringifyJson(payload);
  return {
    runId: toText(item.runId, fallback.runId),
    providerKey: toText(item.providerKey, fallback.providerKey),
    providerItemId: toNullableText(
      item.providerItemId
      || item.newsId
      || item.news_id
      || item.id
      || item.ts_code,
    ),
    categoryKey: toNullableText(item.providerCategoryKey || item.categoryKey || fallback.categoryKey),
    payloadJson,
    payloadHash: sha256(payloadJson),
    publishedAt: toNullableText(normalizeSourceDateTime(pickPublishedAtCandidate(item))),
  };
}

function toNewsItemInput(item = {}) {
  const providerKey = toText(item.providerKey);
  const newsUid = toText(item.newsUid);
  if (!providerKey || !newsUid) return null;

  return {
    newsUid,
    providerKey,
    providerItemId: toNullableText(item.providerItemId),
    providerCategoryKey: toNullableText(item.providerCategoryKey),
    canonicalTitle: toNullableText(item.canonicalTitle),
    title: toText(item.title, '无标题'),
    summary: toNullableText(item.summary),
    content: toNullableText(item.content),
    url: toNullableText(item.url),
    sourceName: toNullableText(item.sourceName),
    author: toNullableText(item.author),
    lang: toNullableText(item.lang),
    region: toNullableText(item.region),
    importanceScore: toNumber(item.importanceScore, 0),
    hotScore: toNumber(item.hotScore, 0),
    dedupeFingerprint: toNullableText(item.dedupeFingerprint),
    eventFingerprint: toNullableText(item.eventFingerprint),
    publishedAt: toNullableText(normalizeSourceDateTime(pickPublishedAtCandidate(item))),
    metaJson: stringifyJson(item.meta || {}),
  };
}

function hasNewsItemChanged(existing = {}, incoming = {}) {
  const textDiff = (
    toNullableText(existing.provider_item_id) !== toNullableText(incoming.providerItemId)
    || toNullableText(existing.provider_category_key) !== toNullableText(incoming.providerCategoryKey)
    || toNullableText(existing.canonical_title) !== toNullableText(incoming.canonicalTitle)
    || toText(existing.title) !== toText(incoming.title)
    || toNullableText(existing.summary) !== toNullableText(incoming.summary)
    || toNullableText(existing.content) !== toNullableText(incoming.content)
    || toNullableText(existing.url) !== toNullableText(incoming.url)
    || toNullableText(existing.source_name) !== toNullableText(incoming.sourceName)
    || toNullableText(existing.author) !== toNullableText(incoming.author)
    || toNullableText(existing.lang) !== toNullableText(incoming.lang)
    || toNullableText(existing.region) !== toNullableText(incoming.region)
    || toNullableText(existing.dedupe_fingerprint) !== toNullableText(incoming.dedupeFingerprint)
    || toNullableText(existing.event_fingerprint) !== toNullableText(incoming.eventFingerprint)
    || toNullableText(existing.published_at) !== toNullableText(incoming.publishedAt)
    || toNullableText(existing.meta_json) !== toNullableText(incoming.metaJson)
  );
  if (textDiff) return true;

  if (toNumber(existing.importance_score, 0) !== toNumber(incoming.importanceScore, 0)) return true;
  if (toNumber(existing.hot_score, 0) !== toNumber(incoming.hotScore, 0)) return true;
  return false;
}

function toTimestamp(value) {
  const date = new Date(value || '');
  const ts = date.getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function preferText(existingValue, incomingValue) {
  const existingText = toNullableText(existingValue);
  const incomingText = toNullableText(incomingValue);
  if (!existingText) return incomingText;
  if (!incomingText) return existingText;
  return incomingText.length > existingText.length ? incomingText : existingText;
}

function preferNumber(existingValue, incomingValue, fallback = 0) {
  return Math.max(toNumber(existingValue, fallback), toNumber(incomingValue, fallback));
}

function preferPublishedAt(existingValue, incomingValue) {
  const existingTs = toTimestamp(existingValue);
  const incomingTs = toTimestamp(incomingValue);
  if (!existingTs) return toNullableText(incomingValue);
  if (!incomingTs) return toNullableText(existingValue);
  return existingTs <= incomingTs ? toNullableText(existingValue) : toNullableText(incomingValue);
}

function buildSourceRecordFromRow(row = {}) {
  return {
    providerKey: toNullableText(row.provider_key),
    providerItemId: toNullableText(row.provider_item_id),
    providerCategoryKey: toNullableText(row.provider_category_key),
    sourceName: toNullableText(row.source_name),
    url: toNullableText(row.url),
    publishedAt: toNullableText(row.published_at),
  };
}

function buildSourceRecordFromIncoming(item = {}) {
  return {
    providerKey: toNullableText(item.providerKey),
    providerItemId: toNullableText(item.providerItemId),
    providerCategoryKey: toNullableText(item.providerCategoryKey),
    sourceName: toNullableText(item.sourceName),
    url: toNullableText(item.url),
    publishedAt: toNullableText(normalizeSourceDateTime(pickPublishedAtCandidate(item))),
  };
}

function normalizeMetaWithSources(meta, row = {}) {
  const sourceRecord = buildSourceRecordFromRow(row);
  const providerKey = toNullableText(row.provider_key);
  const sourceName = toNullableText(row.source_name);
  const next = meta && typeof meta === 'object' && !Array.isArray(meta)
    ? { ...meta }
    : { raw: meta ?? null };

  const sourceProviders = Array.isArray(next.sourceProviders) ? [...next.sourceProviders] : [];
  if (providerKey && !sourceProviders.includes(providerKey)) sourceProviders.push(providerKey);

  const sourceNames = Array.isArray(next.sourceNames) ? [...next.sourceNames] : [];
  if (sourceName && !sourceNames.includes(sourceName)) sourceNames.push(sourceName);

  const sourceRecords = Array.isArray(next.sourceRecords) ? [...next.sourceRecords] : [];
  const sourceKey = `${sourceRecord.providerKey || ''}:${sourceRecord.providerItemId || ''}`;
  if (sourceKey !== ':' && !sourceRecords.some((item) => `${item?.providerKey || ''}:${item?.providerItemId || ''}` === sourceKey)) {
    sourceRecords.push(sourceRecord);
  }

  return {
    ...next,
    primaryProviderKey: toNullableText(next.primaryProviderKey || providerKey),
    primaryProviderItemId: toNullableText(next.primaryProviderItemId || row.provider_item_id),
    sourceProviders,
    sourceNames,
    sourceRecords,
    mergedSourceCount: sourceRecords.length || sourceProviders.length || 1,
  };
}

function mergeMetaJson(existingRow = {}, incoming = {}) {
  const existingMeta = normalizeMetaWithSources(parseJson(existingRow.meta_json, null), existingRow);
  const incomingRawMeta = parseJson(incoming.metaJson, null);
  if (incomingRawMeta && typeof incomingRawMeta === 'object' && !Array.isArray(incomingRawMeta) && incomingRawMeta.raw !== undefined) {
    existingMeta.raw = existingMeta.raw ?? incomingRawMeta.raw;
  } else if (existingMeta.raw === undefined && incomingRawMeta !== null) {
    existingMeta.raw = incomingRawMeta;
  }

  const incomingProviderKey = toNullableText(incoming.providerKey);
  const incomingSourceName = toNullableText(incoming.sourceName);
  const sourceProviders = Array.isArray(existingMeta.sourceProviders) ? [...existingMeta.sourceProviders] : [];
  if (incomingProviderKey && !sourceProviders.includes(incomingProviderKey)) sourceProviders.push(incomingProviderKey);

  const sourceNames = Array.isArray(existingMeta.sourceNames) ? [...existingMeta.sourceNames] : [];
  if (incomingSourceName && !sourceNames.includes(incomingSourceName)) sourceNames.push(incomingSourceName);

  const sourceRecords = Array.isArray(existingMeta.sourceRecords) ? [...existingMeta.sourceRecords] : [];
  const incomingRecord = buildSourceRecordFromIncoming(incoming);
  const incomingRecordKey = `${incomingRecord.providerKey || ''}:${incomingRecord.providerItemId || ''}`;
  if (incomingRecordKey !== ':' && !sourceRecords.some((item) => `${item?.providerKey || ''}:${item?.providerItemId || ''}` === incomingRecordKey)) {
    sourceRecords.push(incomingRecord);
  }

  return stringifyJson({
    ...existingMeta,
    sourceProviders,
    sourceNames,
    sourceRecords,
    mergedSourceCount: sourceRecords.length || sourceProviders.length || 1,
  });
}

function buildMergedIncoming(existingRow = {}, incoming = {}) {
  return {
    newsUid: toText(existingRow.news_uid),
    providerKey: toText(existingRow.provider_key),
    providerItemId: toNullableText(existingRow.provider_item_id),
    providerCategoryKey: toNullableText(existingRow.provider_category_key) || toNullableText(incoming.providerCategoryKey),
    canonicalTitle: preferText(existingRow.canonical_title, incoming.canonicalTitle),
    title: preferText(existingRow.title, incoming.title) || toText(existingRow.title, '无标题'),
    summary: preferText(existingRow.summary, incoming.summary),
    content: preferText(existingRow.content, incoming.content),
    url: toNullableText(existingRow.url) || toNullableText(incoming.url),
    sourceName: toNullableText(existingRow.source_name) || toNullableText(incoming.sourceName),
    author: toNullableText(existingRow.author) || toNullableText(incoming.author),
    lang: toNullableText(existingRow.lang) || toNullableText(incoming.lang),
    region: toNullableText(existingRow.region) || toNullableText(incoming.region),
    importanceScore: preferNumber(existingRow.importance_score, incoming.importanceScore, 0),
    hotScore: preferNumber(existingRow.hot_score, incoming.hotScore, 0),
    dedupeFingerprint: toNullableText(existingRow.dedupe_fingerprint) || toNullableText(incoming.dedupeFingerprint),
    eventFingerprint: toNullableText(existingRow.event_fingerprint) || toNullableText(incoming.eventFingerprint),
    publishedAt: preferPublishedAt(existingRow.published_at, incoming.publishedAt),
    metaJson: mergeMetaJson(existingRow, incoming),
  };
}

function mapProvider(row) {
  if (!row) return null;
  return {
    id: row.id,
    providerKey: row.provider_key,
    name: row.name,
    enabled: row.enabled === 1,
    priority: row.priority,
    config: parseJson(row.config_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProviderCategory(row) {
  if (!row) return null;
  return {
    id: row.id,
    providerKey: row.provider_key,
    categoryKey: row.category_key,
    parentCategoryKey: row.parent_category_key,
    name: row.name,
    level: row.level,
    sortOrder: row.sort_order,
    isActive: row.is_active === 1,
    schedulerEnabled: row.scheduler_enabled !== 0,
    schedulerPriority: Number(row.scheduler_priority || 100),
    meta: parseJson(row.meta_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTaxonomy(row) {
  if (!row) return null;
  return {
    id: row.id,
    taxonomyKey: row.taxonomy_key,
    parentTaxonomyKey: row.parent_taxonomy_key,
    name: row.name,
    level: row.level,
    sortOrder: row.sort_order,
    isActive: row.is_active === 1,
    description: row.description || '',
    meta: parseJson(row.meta_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTaxonomyMapping(row) {
  if (!row) return null;
  return {
    id: row.id,
    providerKey: row.provider_key,
    providerCategoryKey: row.provider_category_key,
    taxonomyKey: row.taxonomy_key,
    mappingType: row.mapping_type,
    confidence: Number(row.confidence || 0),
    isManual: row.is_manual === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSyncRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    providerKey: row.provider_key,
    categoryKey: row.category_key || '',
    triggerType: row.trigger_type,
    status: row.status,
    syncMode: row.sync_mode,
    windowStart: row.window_start || null,
    windowEnd: row.window_end || null,
    requestedAt: row.requested_at,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    rawCount: row.raw_count || 0,
    normalizedCount: row.normalized_count || 0,
    insertedCount: row.inserted_count || 0,
    updatedCount: row.updated_count || 0,
    dedupedCount: row.deduped_count || 0,
    failedCount: row.failed_count || 0,
    errorMessage: row.error_message || '',
    stats: parseJson(row.stats_json, {}),
  };
}

function mapSchedulerState(row) {
  if (!row) return null;
  return {
    providerKey: row.provider_key,
    roundRobinCursor: Number(row.round_robin_cursor || 0),
    lastCatalogSyncAt: Number(row.last_catalog_sync_at || 0),
    retryState: parseJson(row.retry_state_json, {}),
    lastTickAt: row.last_tick_at || null,
    lastResult: parseJson(row.last_result_json, null),
    updatedAt: row.updated_at || null,
  };
}

export const focusNewsRepository = {
  listProviders() {
    const db = getDb();
    return db
      .prepare('SELECT * FROM news_providers ORDER BY priority ASC, id ASC')
      .all()
      .map(mapProvider);
  },

  getProvider(providerKey) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM news_providers WHERE provider_key = ?').get(providerKey);
    return mapProvider(row);
  },

  upsertProvider(item = {}) {
    const db = getDb();
    db.prepare(`
      INSERT INTO news_providers (
        provider_key, name, enabled, priority, config_json, created_at, updated_at
      ) VALUES (
        @providerKey, @name, @enabled, @priority, @configJson, datetime('now'), datetime('now')
      )
      ON CONFLICT(provider_key) DO UPDATE SET
        name = excluded.name,
        enabled = excluded.enabled,
        priority = excluded.priority,
        config_json = excluded.config_json,
        updated_at = datetime('now')
    `).run({
      providerKey: item.providerKey,
      name: item.name,
      enabled: item.enabled === false ? 0 : 1,
      priority: Number(item.priority || 100),
      configJson: JSON.stringify(item.config || {}),
    });
    return this.getProvider(item.providerKey);
  },

  listProviderCategories({ providerKey = '' } = {}) {
    const db = getDb();
    if (providerKey) {
      return db
        .prepare(`
          SELECT *
          FROM news_provider_categories
          WHERE provider_key = ?
          ORDER BY level ASC, sort_order ASC, id ASC
        `)
        .all(providerKey)
        .map(mapProviderCategory);
    }
    return db
      .prepare(`
        SELECT *
        FROM news_provider_categories
        ORDER BY provider_key ASC, level ASC, sort_order ASC, id ASC
      `)
      .all()
      .map(mapProviderCategory);
  },

  replaceProviderCategories(providerKey, items = []) {
    const db = getDb();
    const key = String(providerKey || '').trim();
    if (!key) return [];

    const normalized = Array.isArray(items)
      ? items
          .map((item) => ({
            providerKey: key,
            categoryKey: String(item.categoryKey || '').trim(),
            parentCategoryKey: String(item.parentCategoryKey || '').trim() || null,
            name: String(item.name || '').trim(),
            level: Number(item.level || 1),
            sortOrder: Number(item.sortOrder || 100),
            isActive: item.isActive === false ? 0 : 1,
            schedulerEnabled: item.schedulerEnabled === false ? 0 : 1,
            schedulerPriority: Number.isFinite(Number(item.schedulerPriority))
              ? Number(item.schedulerPriority)
              : Number(item.sortOrder || 100),
            metaJson: JSON.stringify(item.meta || {}),
          }))
          .filter((item) => item.categoryKey && item.name)
      : [];

    const upsert = db.prepare(`
      INSERT INTO news_provider_categories (
        provider_key, category_key, parent_category_key, name,
        level, sort_order, is_active, scheduler_enabled, scheduler_priority,
        meta_json, created_at, updated_at
      ) VALUES (
        @providerKey, @categoryKey, @parentCategoryKey, @name,
        @level, @sortOrder, @isActive, @schedulerEnabled, @schedulerPriority,
        @metaJson, datetime('now'), datetime('now')
      )
      ON CONFLICT(provider_key, category_key) DO UPDATE SET
        parent_category_key = excluded.parent_category_key,
        name = excluded.name,
        level = excluded.level,
        sort_order = excluded.sort_order,
        is_active = excluded.is_active,
        meta_json = excluded.meta_json,
        updated_at = datetime('now')
    `);

    const touchedKeys = normalized.map((item) => item.categoryKey);
    const tx = db.transaction((payload) => {
      payload.forEach((item) => upsert.run(item));
    });
    tx(normalized);

    if (touchedKeys.length) {
      const placeholders = touchedKeys.map(() => '?').join(',');
      db.prepare(`
        UPDATE news_provider_categories
        SET is_active = 0, updated_at = datetime('now')
        WHERE provider_key = ?
          AND category_key NOT IN (${placeholders})
      `).run(key, ...touchedKeys);
    }

    return this.listProviderCategories({ providerKey: key });
  },

  updateSchedulerCategoryPolicy({
    providerKey = '',
    categoryKey = '',
    schedulerEnabled,
    schedulerPriority,
  } = {}) {
    const db = getDb();
    const key = String(providerKey || '').trim();
    const cKey = String(categoryKey || '').trim();
    if (!key || !cKey) return null;

    const patchParts = [];
    const params = {
      providerKey: key,
      categoryKey: cKey,
    };

    if (schedulerEnabled !== undefined) {
      patchParts.push('scheduler_enabled = @schedulerEnabled');
      params.schedulerEnabled = schedulerEnabled === false ? 0 : 1;
    }
    if (schedulerPriority !== undefined && schedulerPriority !== null) {
      patchParts.push('scheduler_priority = @schedulerPriority');
      params.schedulerPriority = Number.isFinite(Number(schedulerPriority))
        ? Math.trunc(Number(schedulerPriority))
        : 100;
    }

    if (!patchParts.length) {
      return this.listProviderCategories({ providerKey: key }).find((item) => item.categoryKey === cKey) || null;
    }

    patchParts.push("updated_at = datetime('now')");
    db.prepare(`
      UPDATE news_provider_categories
      SET ${patchParts.join(', ')}
      WHERE provider_key = @providerKey
        AND category_key = @categoryKey
    `).run(params);

    return this.listProviderCategories({ providerKey: key }).find((item) => item.categoryKey === cKey) || null;
  },

  listTaxonomies() {
    const db = getDb();
    return db
      .prepare('SELECT * FROM news_taxonomies ORDER BY level ASC, sort_order ASC, id ASC')
      .all()
      .map(mapTaxonomy);
  },

  upsertTaxonomies(items = []) {
    if (!Array.isArray(items) || !items.length) return this.listTaxonomies();
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO news_taxonomies (
        taxonomy_key, parent_taxonomy_key, name, level, sort_order,
        is_active, description, meta_json, created_at, updated_at
      ) VALUES (
        @taxonomyKey, @parentTaxonomyKey, @name, @level, @sortOrder,
        @isActive, @description, @metaJson, datetime('now'), datetime('now')
      )
      ON CONFLICT(taxonomy_key) DO UPDATE SET
        parent_taxonomy_key = excluded.parent_taxonomy_key,
        name = excluded.name,
        level = excluded.level,
        sort_order = excluded.sort_order,
        is_active = excluded.is_active,
        description = excluded.description,
        meta_json = excluded.meta_json,
        updated_at = datetime('now')
    `);
    const tx = db.transaction((payload) => {
      payload.forEach((item) => {
        stmt.run({
          taxonomyKey: item.taxonomyKey,
          parentTaxonomyKey: item.parentTaxonomyKey || null,
          name: item.name,
          level: Number(item.level || 1),
          sortOrder: Number(item.sortOrder || 100),
          isActive: item.isActive === false ? 0 : 1,
          description: String(item.description || '').trim(),
          metaJson: JSON.stringify(item.meta || {}),
        });
      });
    });
    tx(items.filter((item) => item?.taxonomyKey && item?.name));
    return this.listTaxonomies();
  },

  listTaxonomyMappings({ providerKey = '' } = {}) {
    const db = getDb();
    if (providerKey) {
      return db
        .prepare(`
          SELECT *
          FROM news_taxonomy_mappings
          WHERE provider_key = ?
          ORDER BY provider_category_key ASC, confidence DESC, id ASC
        `)
        .all(providerKey)
        .map(mapTaxonomyMapping);
    }
    return db
      .prepare(`
        SELECT *
        FROM news_taxonomy_mappings
        ORDER BY provider_key ASC, provider_category_key ASC, confidence DESC, id ASC
      `)
      .all()
      .map(mapTaxonomyMapping);
  },

  upsertTaxonomyMappings(items = []) {
    if (!Array.isArray(items) || !items.length) return [];
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO news_taxonomy_mappings (
        provider_key, provider_category_key, taxonomy_key,
        mapping_type, confidence, is_manual, created_at, updated_at
      ) VALUES (
        @providerKey, @providerCategoryKey, @taxonomyKey,
        @mappingType, @confidence, @isManual, datetime('now'), datetime('now')
      )
      ON CONFLICT(provider_key, provider_category_key, taxonomy_key) DO UPDATE SET
        mapping_type = excluded.mapping_type,
        confidence = excluded.confidence,
        is_manual = excluded.is_manual,
        updated_at = datetime('now')
    `);
    const tx = db.transaction((payload) => {
      payload.forEach((item) => {
        stmt.run({
          providerKey: item.providerKey,
          providerCategoryKey: item.providerCategoryKey,
          taxonomyKey: item.taxonomyKey,
          mappingType: String(item.mappingType || 'auto'),
          confidence: Number(item.confidence ?? 0.8),
          isManual: item.isManual ? 1 : 0,
        });
      });
    });
    tx(items.filter((item) => item?.providerKey && item?.providerCategoryKey && item?.taxonomyKey));
    return this.listTaxonomyMappings();
  },

  createSyncRun(item = {}) {
    const db = getDb();
    db.prepare(`
      INSERT INTO news_sync_runs (
        run_id, provider_key, category_key, trigger_type, status, sync_mode,
        window_start, window_end, requested_at, started_at, stats_json
      ) VALUES (
        @runId, @providerKey, @categoryKey, @triggerType, @status, @syncMode,
        @windowStart, @windowEnd, datetime('now'), @startedAt, @statsJson
      )
    `).run({
      runId: item.runId,
      providerKey: item.providerKey,
      categoryKey: item.categoryKey || null,
      triggerType: item.triggerType || 'manual',
      status: item.status || 'queued',
      syncMode: item.syncMode || 'catalog',
      windowStart: item.windowStart || null,
      windowEnd: item.windowEnd || null,
      startedAt: item.startedAt || null,
      statsJson: JSON.stringify(item.stats || {}),
    });
    return this.getSyncRun(item.runId);
  },

  updateSyncRun(runId, patch = {}) {
    const db = getDb();
    db.prepare(`
      UPDATE news_sync_runs
      SET status = COALESCE(@status, status),
          started_at = COALESCE(@startedAt, started_at),
          finished_at = COALESCE(@finishedAt, finished_at),
          raw_count = COALESCE(@rawCount, raw_count),
          normalized_count = COALESCE(@normalizedCount, normalized_count),
          inserted_count = COALESCE(@insertedCount, inserted_count),
          updated_count = COALESCE(@updatedCount, updated_count),
          deduped_count = COALESCE(@dedupedCount, deduped_count),
          failed_count = COALESCE(@failedCount, failed_count),
          error_message = COALESCE(@errorMessage, error_message),
          stats_json = COALESCE(@statsJson, stats_json)
      WHERE run_id = @runId
    `).run({
      runId,
      status: patch.status || null,
      startedAt: patch.startedAt || null,
      finishedAt: patch.finishedAt || null,
      rawCount: Number.isFinite(Number(patch.rawCount)) ? Number(patch.rawCount) : null,
      normalizedCount: Number.isFinite(Number(patch.normalizedCount)) ? Number(patch.normalizedCount) : null,
      insertedCount: Number.isFinite(Number(patch.insertedCount)) ? Number(patch.insertedCount) : null,
      updatedCount: Number.isFinite(Number(patch.updatedCount)) ? Number(patch.updatedCount) : null,
      dedupedCount: Number.isFinite(Number(patch.dedupedCount)) ? Number(patch.dedupedCount) : null,
      failedCount: Number.isFinite(Number(patch.failedCount)) ? Number(patch.failedCount) : null,
      errorMessage: patch.errorMessage ? String(patch.errorMessage) : null,
      statsJson: patch.stats ? JSON.stringify(patch.stats) : null,
    });
    return this.getSyncRun(runId);
  },

  getSyncRun(runId) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM news_sync_runs WHERE run_id = ?').get(runId);
    return mapSyncRun(row);
  },

  listSyncRuns({
    limit = 50,
    providerKey = '',
    triggerType = '',
    status = '',
  } = {}) {
    const db = getDb();
    const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(Number(limit), 200)) : 50;
    const where = ['1 = 1'];
    const params = { limit: safeLimit };
    if (providerKey) {
      where.push('provider_key = @providerKey');
      params.providerKey = String(providerKey || '').trim();
    }
    if (triggerType) {
      where.push('trigger_type = @triggerType');
      params.triggerType = String(triggerType || '').trim();
    }
    if (status) {
      where.push('status = @status');
      params.status = String(status || '').trim();
    }

    return db
      .prepare(`
        SELECT *
        FROM news_sync_runs
        WHERE ${where.join(' AND ')}
        ORDER BY requested_at DESC, id DESC
        LIMIT @limit
      `)
      .all(params)
      .map(mapSyncRun);
  },

  getSchedulerState({ providerKey = 'tushare' } = {}) {
    const db = getDb();
    const key = String(providerKey || '').trim() || 'tushare';
    const row = db
      .prepare('SELECT * FROM news_scheduler_states WHERE provider_key = ?')
      .get(key);
    return mapSchedulerState(row);
  },

  upsertSchedulerState(item = {}) {
    const db = getDb();
    const providerKey = String(item.providerKey || '').trim() || 'tushare';
    const roundRobinCursor = Number.isFinite(Number(item.roundRobinCursor))
      ? Math.max(0, Math.trunc(Number(item.roundRobinCursor)))
      : 0;
    const lastCatalogSyncAt = Number.isFinite(Number(item.lastCatalogSyncAt))
      ? Math.max(0, Math.trunc(Number(item.lastCatalogSyncAt)))
      : 0;
    db.prepare(`
      INSERT INTO news_scheduler_states (
        provider_key, round_robin_cursor, last_catalog_sync_at,
        retry_state_json, last_tick_at, last_result_json, updated_at
      ) VALUES (
        @providerKey, @roundRobinCursor, @lastCatalogSyncAt,
        @retryStateJson, @lastTickAt, @lastResultJson, datetime('now')
      )
      ON CONFLICT(provider_key) DO UPDATE SET
        round_robin_cursor = excluded.round_robin_cursor,
        last_catalog_sync_at = excluded.last_catalog_sync_at,
        retry_state_json = excluded.retry_state_json,
        last_tick_at = excluded.last_tick_at,
        last_result_json = excluded.last_result_json,
        updated_at = datetime('now')
    `).run({
      providerKey,
      roundRobinCursor,
      lastCatalogSyncAt,
      retryStateJson: stringifyJson(item.retryState || {}),
      lastTickAt: toNullableText(item.lastTickAt),
      lastResultJson: stringifyJson(item.lastResult ?? null, 'null'),
    });
    return this.getSchedulerState({ providerKey });
  },

  listNewsItems({
    providerKey = '',
    categoryKey = '',
    q = '',
    page = 1,
    limit = 20,
  } = {}) {
    const db = getDb();
    const where = ['1 = 1'];
    const params = {};

    if (providerKey) {
      where.push('provider_key = @providerKey');
      params.providerKey = providerKey;
    }
    if (categoryKey) {
      where.push('provider_category_key = @categoryKey');
      params.categoryKey = categoryKey;
    }
    const keyword = String(q || '').trim();
    if (keyword) {
      where.push('(title LIKE @keyword OR summary LIKE @keyword OR content LIKE @keyword)');
      params.keyword = `%${keyword}%`;
    }

    const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(Number(limit), 100)) : 20;
    const safePage = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : 1;
    const offset = (safePage - 1) * safeLimit;
    const whereSql = where.join(' AND ');

    const total = Number(
      db.prepare(`SELECT COUNT(1) as count FROM news_items WHERE ${whereSql}`).get(params)?.count || 0,
    );
    const rows = db.prepare(`
      SELECT *
      FROM news_items
      WHERE ${whereSql}
      ORDER BY published_at DESC, id DESC
      LIMIT @limit OFFSET @offset
    `).all({
      ...params,
      limit: safeLimit,
      offset,
    });

    return {
      total,
      page: safePage,
      limit: safeLimit,
      items: rows.map((row) => ({
        id: row.id,
        newsUid: row.news_uid,
        providerKey: row.provider_key,
        providerItemId: row.provider_item_id,
        providerCategoryKey: row.provider_category_key,
        title: row.title,
        summary: row.summary,
        content: row.content,
        sourceName: row.source_name,
        url: row.url,
        importanceScore: Number(row.importance_score || 0),
        hotScore: Number(row.hot_score || 0),
        publishedAt: row.published_at,
        ingestedAt: row.ingested_at,
      })),
    };
  },

  getNewsItemDetail({ newsUid = '', id = '' } = {}) {
    const db = getDb();
    let row = null;

    const uid = String(newsUid || '').trim();
    if (uid) {
      row = db.prepare('SELECT * FROM news_items WHERE news_uid = ?').get(uid);
    }

    if (!row) {
      const parsedId = Number(id);
      if (Number.isFinite(parsedId) && parsedId > 0) {
        row = db.prepare('SELECT * FROM news_items WHERE id = ?').get(parsedId);
      }
    }
    if (!row) return null;

    return {
      id: row.id,
      newsUid: row.news_uid,
      providerKey: row.provider_key,
      providerItemId: row.provider_item_id,
      providerCategoryKey: row.provider_category_key,
      canonicalTitle: row.canonical_title,
      title: row.title,
      summary: row.summary,
      content: row.content,
      url: row.url,
      sourceName: row.source_name,
      author: row.author,
      lang: row.lang,
      region: row.region,
      importanceScore: Number(row.importance_score || 0),
      hotScore: Number(row.hot_score || 0),
      dedupeFingerprint: row.dedupe_fingerprint,
      eventFingerprint: row.event_fingerprint,
      publishedAt: row.published_at,
      ingestedAt: row.ingested_at,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      isDeleted: row.is_deleted === 1,
      meta: parseJson(row.meta_json, {}),
    };
  },

  insertRawItems({ runId = '', providerKey = '', categoryKey = '', items = [] } = {}) {
    const db = getDb();
    const normalized = Array.isArray(items)
      ? items
          .map((item) => toRawItemInput(item, { runId, providerKey, categoryKey }))
          .filter((item) => item.runId && item.providerKey && item.payloadJson)
      : [];

    if (!normalized.length) return 0;
    const stmt = db.prepare(`
      INSERT INTO news_raw_items (
        run_id, provider_key, provider_item_id, category_key,
        payload_json, payload_hash, published_at, fetched_at
      ) VALUES (
        @runId, @providerKey, @providerItemId, @categoryKey,
        @payloadJson, @payloadHash, @publishedAt, datetime('now')
      )
    `);
    const tx = db.transaction((payload) => {
      payload.forEach((item) => stmt.run(item));
    });
    tx(normalized);
    return normalized.length;
  },

  upsertNewsItems(items = []) {
    const db = getDb();
    const payload = Array.isArray(items)
      ? items.map((item) => toNewsItemInput(item)).filter(Boolean)
      : [];
    if (!payload.length) {
      return {
        total: 0,
        inserted: 0,
        updated: 0,
        deduped: 0,
        failed: 0,
      };
    }

    const findByUid = db.prepare('SELECT * FROM news_items WHERE news_uid = ?');
    const findByProviderItem = db.prepare(`
      SELECT *
      FROM news_items
      WHERE provider_key = ? AND provider_item_id = ?
    `);
    const findByDedupeFingerprint = db.prepare(`
      SELECT *
      FROM news_items
      WHERE provider_key = ? AND dedupe_fingerprint = ?
      ORDER BY id DESC
      LIMIT 1
    `);
    const findByEventFingerprint = db.prepare(`
      SELECT *
      FROM news_items
      WHERE event_fingerprint = ?
      ORDER BY published_at DESC, id DESC
      LIMIT 1
    `);
    const insertStmt = db.prepare(`
      INSERT INTO news_items (
        news_uid, provider_key, provider_item_id, provider_category_key,
        canonical_title, title, summary, content, url, source_name, author,
        lang, region, importance_score, hot_score, dedupe_fingerprint, event_fingerprint,
        published_at, ingested_at, first_seen_at, last_seen_at, is_deleted, meta_json
      ) VALUES (
        @newsUid, @providerKey, @providerItemId, @providerCategoryKey,
        @canonicalTitle, @title, @summary, @content, @url, @sourceName, @author,
        @lang, @region, @importanceScore, @hotScore, @dedupeFingerprint, @eventFingerprint,
        @publishedAt, datetime('now'), datetime('now'), datetime('now'), 0, @metaJson
      )
    `);
    const updateStmt = db.prepare(`
      UPDATE news_items
      SET provider_item_id = COALESCE(@providerItemId, provider_item_id),
          provider_category_key = @providerCategoryKey,
          canonical_title = @canonicalTitle,
          title = @title,
          summary = @summary,
          content = @content,
          url = @url,
          source_name = @sourceName,
          author = @author,
          lang = @lang,
          region = @region,
          importance_score = @importanceScore,
          hot_score = @hotScore,
          dedupe_fingerprint = @dedupeFingerprint,
          event_fingerprint = @eventFingerprint,
          published_at = @publishedAt,
          ingested_at = datetime('now'),
          last_seen_at = datetime('now'),
          is_deleted = 0,
          meta_json = @metaJson
      WHERE id = @id
    `);
    const touchStmt = db.prepare(`
      UPDATE news_items
      SET last_seen_at = datetime('now'),
          is_deleted = 0
      WHERE id = ?
    `);

    const stats = {
      total: payload.length,
      inserted: 0,
      updated: 0,
      deduped: 0,
      failed: 0,
    };

    const tx = db.transaction((rows) => {
      rows.forEach((item) => {
        try {
          let existing = null;
          if (item.providerItemId) {
            existing = findByProviderItem.get(item.providerKey, item.providerItemId);
          }
          if (!existing) {
            existing = findByUid.get(item.newsUid);
          }
          if (!existing && item.dedupeFingerprint) {
            existing = findByDedupeFingerprint.get(item.providerKey, item.dedupeFingerprint);
          }
          if (!existing && item.eventFingerprint) {
            existing = findByEventFingerprint.get(item.eventFingerprint);
          }

          if (!existing) {
            insertStmt.run(item);
            stats.inserted += 1;
            return;
          }

          const isCrossProviderEvent = (
            toText(existing.provider_key) !== toText(item.providerKey)
            && toNullableText(existing.event_fingerprint)
            && toNullableText(existing.event_fingerprint) === toNullableText(item.eventFingerprint)
          );
          const incomingItem = isCrossProviderEvent
            ? buildMergedIncoming(existing, item)
            : item;

          if (!hasNewsItemChanged(existing, incomingItem)) {
            touchStmt.run(existing.id);
            stats.deduped += 1;
            return;
          }

          updateStmt.run({
            ...incomingItem,
            id: existing.id,
          });
          stats.updated += 1;
        } catch {
          stats.failed += 1;
        }
      });
    });
    tx(payload);
    return stats;
  },
};

import { HttpError } from '../utils/httpError.js';
import { aShareMarketMetricRuleRepository } from '../repositories/aShareMarketMetricRuleRepository.js';
import { aShareMarketMetricDailyRepository } from '../repositories/aShareMarketMetricDailyRepository.js';

const PRICE_MODES = new Set(['close_raw', 'close_qfq', 'close_hfq']);
const SCOPE_KEYS = new Set(['ALL_A']);

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
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

function isDateText(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

export function isStName(name = '') {
  const text = String(name || '').trim().toUpperCase();
  if (!text) return false;
  return text.includes('ST');
}

export function isSuspendedSample(sample = {}) {
  const close = Number(sample.closeRaw ?? sample.close ?? sample.price);
  const vol = Number(sample.vol ?? sample.volume ?? 0);
  const amount = Number(sample.amount ?? 0);
  if (!Number.isFinite(close) || close <= 0) return true;
  return vol <= 0 && amount <= 0;
}

export function computeAveragePrice(values = []) {
  const source = Array.isArray(values) ? values : [];
  if (!source.length) return null;
  const nums = source.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (!nums.length) return null;
  const sum = nums.reduce((acc, cur) => acc + cur, 0);
  return Number((sum / nums.length).toFixed(6));
}

export function computeMedianPrice(values = []) {
  const nums = (Array.isArray(values) ? values : [])
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 1) return Number(nums[mid].toFixed(6));
  return Number((((nums[mid - 1] + nums[mid]) / 2)).toFixed(6));
}

function resolveSamplePrice(sample = {}, priceMode = 'close_raw') {
  if (priceMode === 'close_qfq') {
    const qfq = Number(sample.closeQfq);
    if (Number.isFinite(qfq) && qfq > 0) return { price: qfq, fallbackRaw: false };
    const raw = Number(sample.closeRaw);
    return Number.isFinite(raw) && raw > 0
      ? { price: raw, fallbackRaw: true }
      : { price: null, fallbackRaw: false };
  }
  if (priceMode === 'close_hfq') {
    const hfq = Number(sample.closeHfq);
    if (Number.isFinite(hfq) && hfq > 0) return { price: hfq, fallbackRaw: false };
    const raw = Number(sample.closeRaw);
    return Number.isFinite(raw) && raw > 0
      ? { price: raw, fallbackRaw: true }
      : { price: null, fallbackRaw: false };
  }

  const raw = Number(sample.closeRaw);
  return Number.isFinite(raw) && raw > 0
    ? { price: raw, fallbackRaw: false }
    : { price: null, fallbackRaw: false };
}

export function filterSamplesByRule(samples = [], rule = {}) {
  const source = Array.isArray(samples) ? samples : [];
  const filtered = [];
  const stats = {
    total: source.length,
    kept: 0,
    removedSuspended: 0,
    removedSt: 0,
    removedNewListing: 0,
    removedInvalidPrice: 0,
    priceModeFallbackToRaw: 0,
  };

  source.forEach((sample) => {
    if (rule.excludeSuspended && isSuspendedSample(sample)) {
      stats.removedSuspended += 1;
      return;
    }

    if (!rule.includeSt && isStName(sample.stockName)) {
      stats.removedSt += 1;
      return;
    }

    const tradingDays = Number(sample.tradingDays || 0);
    if (tradingDays < Number(rule.minListingTradingDays || 0)) {
      stats.removedNewListing += 1;
      return;
    }

    const resolved = resolveSamplePrice(sample, rule.priceMode);
    if (!Number.isFinite(resolved.price) || resolved.price <= 0) {
      stats.removedInvalidPrice += 1;
      return;
    }

    if (resolved.fallbackRaw) {
      stats.priceModeFallbackToRaw += 1;
    }

    filtered.push({
      ...sample,
      price: resolved.price,
    });
  });

  stats.kept = filtered.length;
  return {
    items: filtered,
    stats,
  };
}

export function normalizeMetricRulePayload(payload = {}, { partial = false } = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new HttpError(400, '规则参数无效');
  }

  const normalized = {};

  if (!partial || payload.ruleKey !== undefined) {
    const ruleKey = String(payload.ruleKey || '').trim().toUpperCase();
    if (!ruleKey) throw new HttpError(400, 'ruleKey 不能为空');
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(ruleKey)) {
      throw new HttpError(400, 'ruleKey 格式非法，仅支持字母数字下划线且需字母开头');
    }
    normalized.ruleKey = ruleKey;
  }

  if (!partial || payload.name !== undefined) {
    const name = String(payload.name || '').trim();
    if (!name) throw new HttpError(400, 'name 不能为空');
    normalized.name = name;
  }

  if (!partial || payload.scopeKey !== undefined) {
    const scopeKey = String(payload.scopeKey || 'ALL_A').trim().toUpperCase() || 'ALL_A';
    if (!SCOPE_KEYS.has(scopeKey)) {
      throw new HttpError(400, `scopeKey 不支持: ${scopeKey}`);
    }
    normalized.scopeKey = scopeKey;
  }

  if (!partial || payload.priceMode !== undefined) {
    const priceMode = String(payload.priceMode || 'close_raw').trim().toLowerCase() || 'close_raw';
    if (!PRICE_MODES.has(priceMode)) {
      throw new HttpError(400, `priceMode 不支持: ${priceMode}`);
    }
    normalized.priceMode = priceMode;
  }

  if (!partial || payload.excludeSuspended !== undefined) {
    normalized.excludeSuspended = toBool(payload.excludeSuspended, true);
  }

  if (!partial || payload.minListingTradingDays !== undefined) {
    normalized.minListingTradingDays = toNonNegativeInt(payload.minListingTradingDays, 0);
  }

  if (!partial || payload.includeSt !== undefined) {
    normalized.includeSt = toBool(payload.includeSt, true);
  }

  if (!partial || payload.minSampleSize !== undefined) {
    normalized.minSampleSize = toPositiveInt(payload.minSampleSize, 1);
  }

  if (!partial || payload.isEnabled !== undefined) {
    normalized.isEnabled = toBool(payload.isEnabled, true);
  }

  if (!partial || payload.isDefault !== undefined) {
    normalized.isDefault = toBool(payload.isDefault, false);
  }

  if (!partial) {
    if (normalized.scopeKey === undefined) normalized.scopeKey = 'ALL_A';
    if (normalized.priceMode === undefined) normalized.priceMode = 'close_raw';
    if (normalized.excludeSuspended === undefined) normalized.excludeSuspended = true;
    if (normalized.minListingTradingDays === undefined) normalized.minListingTradingDays = 0;
    if (normalized.includeSt === undefined) normalized.includeSt = true;
    if (normalized.minSampleSize === undefined) normalized.minSampleSize = 1;
    if (normalized.isEnabled === undefined) normalized.isEnabled = true;
    if (normalized.isDefault === undefined) normalized.isDefault = false;
  }

  return normalized;
}

function normalizeTradeDay(input = '') {
  const tradeDay = String(input || '').trim();
  if (!tradeDay) return '';
  if (!isDateText(tradeDay)) {
    throw new HttpError(400, 'tradeDay 格式非法，应为 YYYY-MM-DD');
  }
  return tradeDay;
}

function normalizeScopeKey(input = '') {
  const scopeKey = String(input || 'ALL_A').trim().toUpperCase() || 'ALL_A';
  if (!SCOPE_KEYS.has(scopeKey)) {
    throw new HttpError(400, `scopeKey 不支持: ${scopeKey}`);
  }
  return scopeKey;
}

function normalizeRuleKey(input = '') {
  const ruleKey = String(input || '').trim().toUpperCase();
  if (!ruleKey) return '';
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(ruleKey)) {
    throw new HttpError(400, 'ruleKey 格式非法');
  }
  return ruleKey;
}

function buildRuleWarningMessage(stats = {}, priceMode = 'close_raw') {
  const warnings = [];
  if (stats.priceModeFallbackToRaw > 0 && priceMode !== 'close_raw') {
    warnings.push(`price_mode_fallback_to_close_raw:${stats.priceModeFallbackToRaw}`);
  }
  if (stats.removedSuspended > 0) warnings.push(`removed_suspended:${stats.removedSuspended}`);
  if (stats.removedSt > 0) warnings.push(`removed_st:${stats.removedSt}`);
  if (stats.removedNewListing > 0) warnings.push(`removed_new_listing:${stats.removedNewListing}`);
  return warnings.join(' | ') || null;
}

function nowIso() {
  return new Date().toISOString();
}

function resolveComputeTradeDays({ tradeDay = '', startDay = '', endDay = '' } = {}) {
  const single = normalizeTradeDay(tradeDay);
  const start = normalizeTradeDay(startDay);
  const end = normalizeTradeDay(endDay);

  if (single && (start || end)) {
    throw new HttpError(400, 'tradeDay 与 startDay/endDay 不能同时传入');
  }

  if (single) {
    return {
      mode: 'single',
      startDay: single,
      endDay: single,
      tradeDays: [single],
    };
  }

  if (start || end) {
    if (!start || !end) {
      throw new HttpError(400, 'startDay/endDay 需要同时传入');
    }
    if (start > end) {
      throw new HttpError(400, 'startDay 不能大于 endDay');
    }
    const tradeDays = aShareMarketMetricDailyRepository.listTradeDaysInRange({
      startDay: start,
      endDay: end,
      limit: 2000,
    });
    if (!tradeDays.length) {
      throw new HttpError(404, `区间 ${start}~${end} 未找到可计算的交易日数据`);
    }
    return {
      mode: 'range',
      startDay: start,
      endDay: end,
      tradeDays,
    };
  }

  const latest = aShareMarketMetricDailyRepository.getLatestTradeDay();
  if (!latest) {
    throw new HttpError(404, '未找到可计算的交易日数据');
  }
  return {
    mode: 'single',
    startDay: latest,
    endDay: latest,
    tradeDays: [latest],
  };
}

function resolveDefaultRule(scopeKey = 'ALL_A') {
  const total = aShareMarketMetricRuleRepository.count();
  if (total <= 0) {
    throw new HttpError(409, '规则为空，请至少创建一条规则');
  }
  const defaultRule = aShareMarketMetricRuleRepository.findDefaultByScope(scopeKey);
  if (!defaultRule) {
    throw new HttpError(409, `样本范围 ${scopeKey} 未配置默认规则，请先在规则管理中设置`);
  }
  return defaultRule;
}

function resolveQueryRuleKey({ scopeKey = 'ALL_A', ruleKey = '' } = {}) {
  const normalizedRuleKey = normalizeRuleKey(ruleKey);
  if (normalizedRuleKey) {
    return {
      ruleKey: normalizedRuleKey,
      defaultRuleApplied: false,
    };
  }

  const defaultRule = resolveDefaultRule(scopeKey);
  return {
    ruleKey: defaultRule.ruleKey,
    defaultRuleApplied: true,
  };
}

export const marketMetricsService = {
  listRules({ enabledOnly = false } = {}) {
    const items = aShareMarketMetricRuleRepository.list({ enabledOnly: toBool(enabledOnly, false) });
    return {
      total: items.length,
      items,
    };
  },

  createRule(payload = {}) {
    const normalized = normalizeMetricRulePayload(payload, { partial: false });
    const exists = aShareMarketMetricRuleRepository.findByRuleKey(normalized.ruleKey);
    if (exists) {
      throw new HttpError(409, `ruleKey 已存在: ${normalized.ruleKey}`);
    }

    const ruleCount = aShareMarketMetricRuleRepository.count();
    const defaultRule = aShareMarketMetricRuleRepository.findDefaultByScope(normalized.scopeKey);
    const shouldUseAsDefault = normalized.isDefault || ruleCount <= 0 || !defaultRule;
    if (shouldUseAsDefault && !normalized.isEnabled) {
      throw new HttpError(400, '默认规则必须为启用状态');
    }
    const item = aShareMarketMetricRuleRepository.create({
      ...normalized,
      isDefault: false,
    });
    if (shouldUseAsDefault) {
      return aShareMarketMetricRuleRepository.setDefaultById(item.id, item.scopeKey);
    }
    return item;
  },

  updateRule(ruleId, payload = {}) {
    const id = Number(ruleId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new HttpError(400, 'ruleId 非法');
    }

    const existing = aShareMarketMetricRuleRepository.findById(id);
    if (!existing) {
      throw new HttpError(404, `规则不存在: ${ruleId}`);
    }

    const patch = normalizeMetricRulePayload(payload, { partial: true });
    if (!Object.keys(patch).length) {
      throw new HttpError(400, '未检测到可更新字段');
    }

    if (patch.ruleKey && patch.ruleKey !== existing.ruleKey) {
      const conflict = aShareMarketMetricRuleRepository.findByRuleKey(patch.ruleKey);
      if (conflict && conflict.id !== existing.id) {
        throw new HttpError(409, `ruleKey 已存在: ${patch.ruleKey}`);
      }
    }

    const merged = {
      ...existing,
      ...patch,
    };

    if (patch.isDefault === false && existing.isDefault) {
      throw new HttpError(400, '当前为默认规则，不能直接取消默认；请先将其它规则设为默认');
    }
    if (merged.isDefault && !merged.isEnabled) {
      throw new HttpError(400, '默认规则必须为启用状态');
    }

    const nextIsDefault = Boolean(merged.isDefault);
    const updated = aShareMarketMetricRuleRepository.updateById(id, {
      ...merged,
      isDefault: existing.isDefault && nextIsDefault,
    });
    if (nextIsDefault) {
      return aShareMarketMetricRuleRepository.setDefaultById(updated.id, updated.scopeKey);
    }
    return updated;
  },

  getDaily({ tradeDay = '', scopeKey = '', ruleKey = '' } = {}) {
    const normalizedTradeDay = normalizeTradeDay(tradeDay);
    if (!normalizedTradeDay) {
      throw new HttpError(400, 'tradeDay 不能为空');
    }

    const normalizedScope = normalizeScopeKey(scopeKey || 'ALL_A');
    const resolvedRule = resolveQueryRuleKey({
      scopeKey: normalizedScope,
      ruleKey,
    });
    const items = aShareMarketMetricDailyRepository.getDaily({
      tradeDay: normalizedTradeDay,
      scopeKey: normalizedScope,
      ruleKey: resolvedRule.ruleKey,
    });

    return {
      tradeDay: normalizedTradeDay,
      scopeKey: normalizedScope,
      ruleKey: resolvedRule.ruleKey,
      defaultRuleApplied: resolvedRule.defaultRuleApplied,
      total: items.length,
      items,
    };
  },

  getDailyRange({ startDay = '', endDay = '', scopeKey = '', ruleKey = '', limit = 500 } = {}) {
    const start = normalizeTradeDay(startDay);
    const end = normalizeTradeDay(endDay);
    if (!start || !end) {
      throw new HttpError(400, 'startDay/endDay 不能为空');
    }
    if (start > end) {
      throw new HttpError(400, 'startDay 不能大于 endDay');
    }

    const normalizedScope = normalizeScopeKey(scopeKey || 'ALL_A');
    const resolvedRule = resolveQueryRuleKey({
      scopeKey: normalizedScope,
      ruleKey,
    });
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 500, 5000));
    const items = aShareMarketMetricDailyRepository.listDailyRange({
      startDay: start,
      endDay: end,
      scopeKey: normalizedScope,
      ruleKey: resolvedRule.ruleKey,
      limit: normalizedLimit,
    });

    return {
      startDay: start,
      endDay: end,
      scopeKey: normalizedScope,
      ruleKey: resolvedRule.ruleKey,
      defaultRuleApplied: resolvedRule.defaultRuleApplied,
      total: items.length,
      limit: normalizedLimit,
      items,
    };
  },

  compute({ tradeDay = '', startDay = '', endDay = '', ruleKey = '', force = false } = {}) {
    const computeRange = resolveComputeTradeDays({
      tradeDay,
      startDay,
      endDay,
    });

    const normalizedRuleKey = normalizeRuleKey(ruleKey);
    const targetRules = normalizedRuleKey
      ? (() => {
        const matched = aShareMarketMetricRuleRepository.findByRuleKey(normalizedRuleKey);
        if (!matched) throw new HttpError(404, `规则不存在: ${normalizedRuleKey}`);
        return [matched];
      })()
      : aShareMarketMetricRuleRepository.list({ enabledOnly: true });

    if (!targetRules.length) {
      throw new HttpError(404, '未找到可执行规则');
    }

    const includeTradingDays = targetRules.some((item) => Number(item.minListingTradingDays || 0) > 0);
    const results = [];
    const errors = [];
    const daySummaries = [];
    const hasForce = toBool(force, false);
    computeRange.tradeDays.forEach((targetDay) => {
      const samples = aShareMarketMetricDailyRepository.listAShareSamplesByTradeDay(targetDay, { includeTradingDays });
      if (!samples.length) {
        daySummaries.push({
          tradeDay: targetDay,
          totalRules: targetRules.length,
          success: 0,
          failed: targetRules.length,
          skipped: 0,
        });
        targetRules.forEach((rule) => {
          errors.push({
            tradeDay: targetDay,
            ruleKey: rule.ruleKey,
            message: `交易日 ${targetDay} 无A股样本`,
            details: null,
          });
        });
        return;
      }

      let daySuccess = 0;
      let dayFailed = 0;
      let daySkipped = 0;

      targetRules.forEach((rule) => {
        try {
          if (!hasForce) {
            const existing = aShareMarketMetricDailyRepository.getDaily({
              tradeDay: targetDay,
              scopeKey: rule.scopeKey,
              ruleKey: rule.ruleKey,
            });
            if (existing.length > 0) {
              daySuccess += 1;
              daySkipped += 1;
              results.push({
                ...existing[0],
                skipped: true,
                reason: 'already_exists',
              });
              return;
            }
          }

          const filtered = filterSamplesByRule(samples, rule);
          if (filtered.items.length < Number(rule.minSampleSize || 1)) {
            throw new HttpError(422, `规则 ${rule.ruleKey} 样本不足`, {
              minSampleSize: rule.minSampleSize,
              actualSampleSize: filtered.items.length,
            });
          }

          const prices = filtered.items.map((item) => item.price);
          const avgPrice = computeAveragePrice(prices);
          const medianPrice = computeMedianPrice(prices);
          const computedAt = nowIso();

          const snapshot = aShareMarketMetricDailyRepository.upsertDaily({
            tradeDay: targetDay,
            ruleId: rule.id,
            ruleKey: rule.ruleKey,
            scopeKey: rule.scopeKey,
            priceMode: rule.priceMode,
            avgPrice,
            medianPrice,
            sampleSize: filtered.items.length,
            sourceDataset: 'stock_eod_bars',
            computedAt,
          });

          daySuccess += 1;
          results.push({
            ...snapshot,
            skipped: false,
            warning: buildRuleWarningMessage(filtered.stats, rule.priceMode),
            stats: filtered.stats,
          });
        } catch (error) {
          dayFailed += 1;
          errors.push({
            tradeDay: targetDay,
            ruleKey: rule.ruleKey,
            message: error.message,
            details: error.details || null,
          });
        }
      });

      daySummaries.push({
        tradeDay: targetDay,
        totalRules: targetRules.length,
        success: daySuccess,
        failed: dayFailed,
        skipped: daySkipped,
      });
    });

    return {
      mode: computeRange.mode,
      tradeDay: computeRange.tradeDays.length === 1 ? computeRange.tradeDays[0] : null,
      startDay: computeRange.startDay,
      endDay: computeRange.endDay,
      totalTradeDays: computeRange.tradeDays.length,
      requestedRuleKey: normalizedRuleKey || null,
      totalRules: targetRules.length * computeRange.tradeDays.length,
      rulesPerDay: targetRules.length,
      success: results.length,
      failed: errors.length,
      skipped: results.filter((item) => item.skipped).length,
      failOpen: true,
      items: results,
      errors,
      daySummaries,
    };
  },
};

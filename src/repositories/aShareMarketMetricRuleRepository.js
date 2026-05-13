import { getDb } from '../db/database.js';

function mapRule(row) {
  if (!row) return null;
  return {
    id: row.id,
    ruleKey: row.rule_key,
    name: row.name,
    scopeKey: row.scope_key,
    priceMode: row.price_mode,
    excludeSuspended: Boolean(row.exclude_suspended),
    minListingTradingDays: Number(row.min_listing_trading_days || 0),
    includeSt: Boolean(row.include_st),
    minSampleSize: Number(row.min_sample_size || 1),
    isEnabled: Boolean(row.is_enabled),
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const aShareMarketMetricRuleRepository = {
  list({ enabledOnly = false } = {}) {
    const db = getDb();
    const where = [];
    const params = {};
    if (enabledOnly) {
      where.push('is_enabled = 1');
    }

    return db.prepare(`
      SELECT *
      FROM a_share_market_metric_rules
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY is_default DESC, is_enabled DESC, updated_at DESC, id DESC
    `).all(params).map(mapRule);
  },

  count() {
    const db = getDb();
    const row = db.prepare(`
      SELECT COUNT(*) AS total
      FROM a_share_market_metric_rules
    `).get();
    return Number(row?.total || 0);
  },

  findById(id) {
    const db = getDb();
    const row = db.prepare(`
      SELECT *
      FROM a_share_market_metric_rules
      WHERE id = ?
      LIMIT 1
    `).get(Number(id));
    return mapRule(row);
  },

  findByRuleKey(ruleKey) {
    const db = getDb();
    const row = db.prepare(`
      SELECT *
      FROM a_share_market_metric_rules
      WHERE rule_key = ?
      LIMIT 1
    `).get(String(ruleKey || '').trim().toUpperCase());
    return mapRule(row);
  },

  findDefaultByScope(scopeKey = 'ALL_A') {
    const db = getDb();
    const row = db.prepare(`
      SELECT *
      FROM a_share_market_metric_rules
      WHERE scope_key = ?
        AND is_default = 1
      LIMIT 1
    `).get(String(scopeKey || 'ALL_A').trim().toUpperCase());
    return mapRule(row);
  },

  create(payload = {}) {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO a_share_market_metric_rules (
        rule_key, name, scope_key, price_mode,
        exclude_suspended, min_listing_trading_days, include_st,
        min_sample_size, is_enabled, is_default,
        created_at, updated_at
      )
      VALUES (
        @ruleKey, @name, @scopeKey, @priceMode,
        @excludeSuspended, @minListingTradingDays, @includeSt,
        @minSampleSize, @isEnabled, @isDefault,
        datetime('now'), datetime('now')
      )
    `).run({
      ruleKey: payload.ruleKey,
      name: payload.name,
      scopeKey: payload.scopeKey,
      priceMode: payload.priceMode,
      excludeSuspended: payload.excludeSuspended ? 1 : 0,
      minListingTradingDays: payload.minListingTradingDays,
      includeSt: payload.includeSt ? 1 : 0,
      minSampleSize: payload.minSampleSize,
      isEnabled: payload.isEnabled ? 1 : 0,
      isDefault: payload.isDefault ? 1 : 0,
    });
    return this.findById(result.lastInsertRowid);
  },

  updateById(id, payload = {}) {
    const db = getDb();
    db.prepare(`
      UPDATE a_share_market_metric_rules
      SET
        rule_key = @ruleKey,
        name = @name,
        scope_key = @scopeKey,
        price_mode = @priceMode,
        exclude_suspended = @excludeSuspended,
        min_listing_trading_days = @minListingTradingDays,
        include_st = @includeSt,
        min_sample_size = @minSampleSize,
        is_enabled = @isEnabled,
        is_default = @isDefault,
        updated_at = datetime('now')
      WHERE id = @id
    `).run({
      id: Number(id),
      ruleKey: payload.ruleKey,
      name: payload.name,
      scopeKey: payload.scopeKey,
      priceMode: payload.priceMode,
      excludeSuspended: payload.excludeSuspended ? 1 : 0,
      minListingTradingDays: payload.minListingTradingDays,
      includeSt: payload.includeSt ? 1 : 0,
      minSampleSize: payload.minSampleSize,
      isEnabled: payload.isEnabled ? 1 : 0,
      isDefault: payload.isDefault ? 1 : 0,
    });
    return this.findById(id);
  },

  setDefaultById(id, scopeKey = 'ALL_A') {
    const db = getDb();
    const normalizedId = Number(id);
    const normalizedScope = String(scopeKey || 'ALL_A').trim().toUpperCase();
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE a_share_market_metric_rules
        SET is_default = 0
        WHERE scope_key = @scopeKey
          AND id != @id
      `).run({
        scopeKey: normalizedScope,
        id: normalizedId,
      });
      db.prepare(`
        UPDATE a_share_market_metric_rules
        SET is_default = 1,
            updated_at = datetime('now')
        WHERE id = @id
      `).run({
        id: normalizedId,
      });
    });
    tx();
    return this.findById(normalizedId);
  },
};

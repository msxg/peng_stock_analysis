import { getDb } from '../db/database.js';
import { getOfficialFuturesTradingHours } from '../utils/tradingHours.js';

function normalizeQuoteCode(value) {
  return String(value || '').trim().toUpperCase();
}

function mapBasic(row) {
  if (!row) return null;
  return {
    quoteCode: row.quote_code,
    market: row.market,
    code: row.code,
    name: row.name,
    exchange: row.exchange,
    tradingHours: getOfficialFuturesTradingHours({
      quoteCode: row.quote_code,
      market: row.market,
      code: row.code,
      exchange: row.exchange,
    }) || null,
    source: row.source,
    syncedAt: row.synced_at,
    updatedAt: row.updated_at,
  };
}

function toParams(item = {}) {
  const quoteCode = normalizeQuoteCode(item.quoteCode);
  if (!quoteCode) return null;

  return {
    quoteCode,
    market: Number.isFinite(Number(item.market)) ? Number(item.market) : null,
    code: String(item.code || quoteCode.split('.').pop() || '').trim().toUpperCase(),
    name: String(item.name || '').trim() || null,
    exchange: String(item.exchange || '').trim() || null,
    tradingHours: String(item.tradingHours || '').trim() || null,
    source: String(item.source || '').trim() || null,
    syncedAt: String(item.syncedAt || '').trim() || null,
  };
}

export const futuresBasicsRepository = {
  upsertMany(items = []) {
    const rows = (Array.isArray(items) ? items : [])
      .map(toParams)
      .filter((item) => item?.quoteCode && item?.code);
    if (!rows.length) return 0;

    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO futures_basics (
        quote_code, market, code, name, exchange, trading_hours, source, synced_at, updated_at
      )
      VALUES (
        @quoteCode, @market, @code, @name, @exchange, @tradingHours, @source, @syncedAt, datetime('now')
      )
      ON CONFLICT(quote_code) DO UPDATE SET
        market = COALESCE(excluded.market, futures_basics.market),
        code = COALESCE(excluded.code, futures_basics.code),
        name = COALESCE(excluded.name, futures_basics.name),
        exchange = COALESCE(excluded.exchange, futures_basics.exchange),
        trading_hours = excluded.trading_hours,
        source = COALESCE(excluded.source, futures_basics.source),
        synced_at = COALESCE(excluded.synced_at, futures_basics.synced_at),
        updated_at = datetime('now')
    `);

    const tx = db.transaction((entries) => {
      entries.forEach((item) => stmt.run(item));
      return entries.length;
    });

    return tx(rows);
  },

  upsertOne(item = {}) {
    return this.upsertMany([item]);
  },

  findByQuoteCode(quoteCode) {
    const normalized = normalizeQuoteCode(quoteCode);
    if (!normalized) return null;
    const db = getDb();
    const row = db.prepare(`
      SELECT *
      FROM futures_basics
      WHERE quote_code = ?
      LIMIT 1
    `).get(normalized);
    return mapBasic(row);
  },

  findByQuoteCodes(quoteCodes = []) {
    const normalized = Array.from(new Set(
      (Array.isArray(quoteCodes) ? quoteCodes : [])
        .map((item) => normalizeQuoteCode(item))
        .filter(Boolean),
    ));
    if (!normalized.length) return [];

    const placeholders = normalized.map(() => '?').join(', ');
    const db = getDb();
    return db.prepare(`
      SELECT *
      FROM futures_basics
      WHERE quote_code IN (${placeholders})
    `).all(...normalized).map(mapBasic);
  },
};

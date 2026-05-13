import { getDb } from '../db/database.js';

function mapDailyRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    tradeDay: row.trade_day,
    ruleId: row.rule_id,
    ruleKey: row.rule_key_snapshot,
    scopeKey: row.scope_key,
    priceMode: row.price_mode,
    avgPrice: row.avg_price,
    medianPrice: row.median_price,
    sampleSize: Number(row.sample_size || 0),
    sourceDataset: row.source_dataset,
    computedAt: row.computed_at,
    createdAt: row.created_at,
  };
}

export const aShareMarketMetricDailyRepository = {
  getLatestTradeDay() {
    const db = getDb();
    const row = db.prepare(`
      SELECT MAX(trade_day) AS trade_day
      FROM stock_eod_bars
      WHERE timeframe = '1d'
    `).get();
    return String(row?.trade_day || '').trim() || null;
  },

  listTradeDaysInRange({ startDay = '', endDay = '', limit = 1000 } = {}) {
    const db = getDb();
    const rows = db.prepare(`
      SELECT DISTINCT trade_day
      FROM stock_eod_bars
      WHERE timeframe = '1d'
        AND trade_day >= @startDay
        AND trade_day <= @endDay
      ORDER BY trade_day ASC
      LIMIT @limit
    `).all({
      startDay: String(startDay || '').trim(),
      endDay: String(endDay || '').trim(),
      limit: Math.max(1, Math.min(Number(limit) || 1000, 5000)),
    });
    return rows
      .map((item) => String(item?.trade_day || '').trim())
      .filter(Boolean);
  },

  upsertDaily(item = {}) {
    if (!item?.tradeDay || !item?.ruleId || !item?.scopeKey) return null;
    const db = getDb();
    db.prepare(`
      INSERT INTO a_share_market_metrics_daily (
        trade_day, rule_id, rule_key_snapshot, scope_key, price_mode,
        avg_price, median_price, sample_size, source_dataset, computed_at, created_at
      ) VALUES (
        @tradeDay, @ruleId, @ruleKey, @scopeKey, @priceMode,
        @avgPrice, @medianPrice, @sampleSize, @sourceDataset, @computedAt, datetime('now')
      )
      ON CONFLICT(trade_day, rule_id, scope_key) DO UPDATE SET
        rule_key_snapshot = excluded.rule_key_snapshot,
        price_mode = excluded.price_mode,
        avg_price = excluded.avg_price,
        median_price = excluded.median_price,
        sample_size = excluded.sample_size,
        source_dataset = excluded.source_dataset,
        computed_at = excluded.computed_at
    `).run({
      tradeDay: item.tradeDay,
      ruleId: item.ruleId,
      ruleKey: item.ruleKey,
      scopeKey: item.scopeKey,
      priceMode: item.priceMode,
      avgPrice: item.avgPrice,
      medianPrice: item.medianPrice,
      sampleSize: item.sampleSize,
      sourceDataset: item.sourceDataset || 'stock_eod_bars',
      computedAt: item.computedAt,
    });

    const row = db.prepare(`
      SELECT *
      FROM a_share_market_metrics_daily
      WHERE trade_day = @tradeDay AND rule_id = @ruleId AND scope_key = @scopeKey
      LIMIT 1
    `).get({
      tradeDay: item.tradeDay,
      ruleId: item.ruleId,
      scopeKey: item.scopeKey,
    });
    return mapDailyRow(row);
  },

  getDaily({ tradeDay = '', scopeKey = '', ruleKey = '' } = {}) {
    const db = getDb();
    const where = ['d.trade_day = @tradeDay'];
    const params = {
      tradeDay: String(tradeDay || '').trim(),
    };

    if (scopeKey) {
      where.push('d.scope_key = @scopeKey');
      params.scopeKey = String(scopeKey).trim().toUpperCase();
    }

    if (ruleKey) {
      where.push('d.rule_key_snapshot = @ruleKey');
      params.ruleKey = String(ruleKey).trim().toUpperCase();
    }

    const rows = db.prepare(`
      SELECT d.*
      FROM a_share_market_metrics_daily d
      WHERE ${where.join(' AND ')}
      ORDER BY d.scope_key ASC, d.rule_id ASC, d.id ASC
    `).all(params);

    return rows.map(mapDailyRow);
  },

  listDailyRange({ startDay = '', endDay = '', scopeKey = '', ruleKey = '', limit = 500 } = {}) {
    const db = getDb();
    const where = ['d.trade_day >= @startDay', 'd.trade_day <= @endDay'];
    const params = {
      startDay: String(startDay || '').trim(),
      endDay: String(endDay || '').trim(),
      limit: Math.max(1, Math.min(Number(limit) || 500, 5000)),
    };

    if (scopeKey) {
      where.push('d.scope_key = @scopeKey');
      params.scopeKey = String(scopeKey).trim().toUpperCase();
    }

    if (ruleKey) {
      where.push('d.rule_key_snapshot = @ruleKey');
      params.ruleKey = String(ruleKey).trim().toUpperCase();
    }

    const rows = db.prepare(`
      SELECT d.*
      FROM a_share_market_metrics_daily d
      WHERE ${where.join(' AND ')}
      ORDER BY d.trade_day DESC, d.scope_key ASC, d.rule_id ASC
      LIMIT @limit
    `).all(params);

    return rows.map(mapDailyRow);
  },

  listAShareSamplesByTradeDay(tradeDay = '', { includeTradingDays = false } = {}) {
    const db = getDb();
    const day = String(tradeDay || '').trim();
    if (!day) return [];

    const baseRows = db.prepare(`
      WITH day_rows AS (
        SELECT
          b.stock_code,
          b.trade_day,
          b.close AS close_raw,
          b.vol,
          b.amount,
          CASE
            WHEN b.stock_code GLOB 'SH[0-9][0-9][0-9][0-9][0-9][0-9]' THEN SUBSTR(b.stock_code, 3)
            WHEN b.stock_code GLOB 'SZ[0-9][0-9][0-9][0-9][0-9][0-9]' THEN SUBSTR(b.stock_code, 3)
            WHEN b.stock_code GLOB 'BJ[0-9][0-9][0-9][0-9][0-9][0-9]' THEN SUBSTR(b.stock_code, 3)
            ELSE b.stock_code
          END AS code_key
        FROM stock_eod_bars b
        WHERE b.timeframe = '1d'
          AND b.trade_day = @tradeDay
      )
      SELECT
        d.stock_code AS stockCode,
        d.trade_day AS tradeDay,
        d.close_raw AS closeRaw,
        NULL AS closeQfq,
        NULL AS closeHfq,
        d.vol AS vol,
        d.amount AS amount,
        COALESCE(sb.name, '') AS stockName,
        sb.listing_date AS listingDate
      FROM day_rows d
      LEFT JOIN stock_basics sb
        ON sb.market = 'A' AND sb.code = d.code_key
      WHERE (
        sb.market = 'A'
        OR d.stock_code GLOB 'SH[0-9][0-9][0-9][0-9][0-9][0-9]'
        OR d.stock_code GLOB 'SZ[0-9][0-9][0-9][0-9][0-9][0-9]'
        OR d.stock_code GLOB 'BJ[0-9][0-9][0-9][0-9][0-9][0-9]'
        OR d.stock_code GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]'
      )
    `).all({ tradeDay: day }).map((row) => ({
      stockCode: row.stockCode,
      tradeDay: row.tradeDay,
      closeRaw: row.closeRaw,
      closeQfq: row.closeQfq,
      closeHfq: row.closeHfq,
      vol: row.vol,
      amount: row.amount,
      stockName: row.stockName,
      listingDate: row.listingDate,
      tradingDays: 0,
    }));

    if (!includeTradingDays || !baseRows.length) {
      return baseRows;
    }

    const placeholders = baseRows.map((_, idx) => `@stockCode${idx}`);
    const params = { tradeDay: day };
    baseRows.forEach((item, idx) => {
      params[`stockCode${idx}`] = item.stockCode;
    });
    const tradingRows = db.prepare(`
      SELECT stock_code AS stockCode, COUNT(*) AS tradingDays
      FROM stock_eod_bars
      WHERE timeframe = '1d'
        AND trade_day <= @tradeDay
        AND stock_code IN (${placeholders.join(', ')})
      GROUP BY stock_code
    `).all(params);
    const tradingMap = new Map(tradingRows.map((item) => [String(item.stockCode || ''), Number(item.tradingDays || 0)]));
    return baseRows.map((item) => ({
      ...item,
      tradingDays: Number(tradingMap.get(item.stockCode) || 0),
    }));
  },
};

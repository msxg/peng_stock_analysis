import { getDb } from '../db/database.js';

function mapCategory(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    isEnabled: row.is_enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSymbol(row) {
  if (!row) return null;
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    quoteCode: row.quote_code,
    market: row.market,
    code: row.code,
    sortOrder: row.sort_order,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapIntradayBar(row) {
  if (!row) return null;
  return {
    quoteCode: row.quote_code,
    timeframe: row.timeframe,
    tradeDay: row.trade_day,
    bucketTs: row.bucket_ts,
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    amount: row.amount,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const futuresRepository = {
  listCategories() {
    const db = getDb();
    return db.prepare(`
      SELECT *
      FROM futures_categories
      ORDER BY sort_order ASC, id ASC
    `).all().map(mapCategory);
  },

  getCategoryById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM futures_categories WHERE id = ?').get(id);
    return mapCategory(row);
  },

  createCategory({ name, description, sortOrder = 100, isEnabled = true }) {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO futures_categories (name, description, sort_order, is_enabled, created_at, updated_at)
      VALUES (@name, @description, @sortOrder, @isEnabled, datetime('now'), datetime('now'))
    `).run({
      name,
      description: description || null,
      sortOrder,
      isEnabled: isEnabled === false ? 0 : 1,
    });

    return this.getCategoryById(result.lastInsertRowid);
  },

  updateCategory(id, { name, description, sortOrder = 100, isEnabled = true }) {
    const db = getDb();
    db.prepare(`
      UPDATE futures_categories
      SET name = @name,
          description = @description,
          sort_order = @sortOrder,
          is_enabled = @isEnabled,
          updated_at = datetime('now')
      WHERE id = @id
    `).run({
      id,
      name,
      description: description || null,
      sortOrder,
      isEnabled: isEnabled === false ? 0 : 1,
    });

    return this.getCategoryById(id);
  },

  deleteCategory(id) {
    const db = getDb();
    return db.prepare('DELETE FROM futures_categories WHERE id = ?').run(id).changes;
  },

  listSymbols({ categoryId, onlyActive = true } = {}) {
    const db = getDb();
    const where = ['1 = 1'];
    const params = {};

    if (Number.isFinite(Number(categoryId)) && Number(categoryId) > 0) {
      where.push('category_id = @categoryId');
      params.categoryId = Number(categoryId);
    }

    if (onlyActive) {
      where.push('is_active = 1');
    }

    return db.prepare(`
      SELECT *
      FROM futures_symbols
      WHERE ${where.join(' AND ')}
      ORDER BY sort_order ASC, id ASC
    `).all(params).map(mapSymbol);
  },

  createSymbol(item) {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO futures_symbols (
        category_id, name, quote_code, market, code, sort_order, is_active, created_at, updated_at
      )
      VALUES (
        @categoryId, @name, @quoteCode, @market, @code, @sortOrder, @isActive, datetime('now'), datetime('now')
      )
    `).run({
      categoryId: item.categoryId,
      name: item.name,
      quoteCode: item.quoteCode,
      market: item.market,
      code: item.code,
      sortOrder: item.sortOrder ?? 100,
      isActive: item.isActive === false ? 0 : 1,
    });

    return this.getSymbolById(result.lastInsertRowid);
  },

  getSymbolById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM futures_symbols WHERE id = ?').get(id);
    return mapSymbol(row);
  },

  deleteSymbol(id) {
    const db = getDb();
    return db.prepare('DELETE FROM futures_symbols WHERE id = ?').run(id).changes;
  },

  upsertIntradayBars({ quoteCode, timeframe = '1m', bars = [] } = {}) {
    const normalizedQuoteCode = String(quoteCode || '').trim().toUpperCase();
    const tf = String(timeframe || '').trim();
    if (!normalizedQuoteCode || !tf || !Array.isArray(bars) || !bars.length) return 0;

    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO futures_intraday_bars (
        quote_code, timeframe, trade_day, bucket_ts, date, open, high, low, close, volume, amount, source, created_at, updated_at
      )
      VALUES (
        @quoteCode, @timeframe, @tradeDay, @bucketTs, @date, @open, @high, @low, @close, @volume, @amount, @source, datetime('now'), datetime('now')
      )
      ON CONFLICT(quote_code, timeframe, bucket_ts) DO UPDATE SET
        trade_day = excluded.trade_day,
        date = excluded.date,
        open = excluded.open,
        high = excluded.high,
        low = excluded.low,
        close = excluded.close,
        volume = excluded.volume,
        amount = excluded.amount,
        source = excluded.source,
        updated_at = datetime('now')
    `);
    const tx = db.transaction((items) => {
      let written = 0;
      items.forEach((item) => {
        stmt.run({
          quoteCode: normalizedQuoteCode,
          timeframe: tf,
          tradeDay: item.tradeDay,
          bucketTs: item.bucketTs,
          date: item.date,
          open: item.open,
          high: item.high,
          low: item.low,
          close: item.close,
          volume: item.volume ?? 0,
          amount: item.amount ?? 0,
          source: item.source || null,
        });
        written += 1;
      });
      return written;
    });

    return tx(bars);
  },

  getLatestIntradayTradeDay({ quoteCode, timeframe = '1m' } = {}) {
    const normalizedQuoteCode = String(quoteCode || '').trim().toUpperCase();
    const tf = String(timeframe || '').trim();
    if (!normalizedQuoteCode || !tf) return null;

    const db = getDb();
    const row = db.prepare(`
      SELECT trade_day
      FROM futures_intraday_bars
      WHERE quote_code = @quoteCode
        AND timeframe = @timeframe
      ORDER BY bucket_ts DESC
      LIMIT 1
    `).get({
      quoteCode: normalizedQuoteCode,
      timeframe: tf,
    });
    return row?.trade_day || null;
  },

  listIntradayBars({ quoteCode, timeframe = '1m', tradeDay, limit = 1800 } = {}) {
    const normalizedQuoteCode = String(quoteCode || '').trim().toUpperCase();
    const tf = String(timeframe || '').trim();
    if (!normalizedQuoteCode || !tf) return [];

    const normalizedLimit = Math.min(Math.max(Number(limit) || 1800, 20), 4000);
    const db = getDb();
    const where = [
      'quote_code = @quoteCode',
      'timeframe = @timeframe',
    ];
    const params = {
      quoteCode: normalizedQuoteCode,
      timeframe: tf,
      limit: normalizedLimit,
    };
    if (tradeDay) {
      where.push('trade_day = @tradeDay');
      params.tradeDay = String(tradeDay);
    }

    return db.prepare(`
      SELECT *
      FROM (
        SELECT *
        FROM futures_intraday_bars
        WHERE ${where.join(' AND ')}
        ORDER BY bucket_ts DESC
        LIMIT @limit
      ) recent
      ORDER BY bucket_ts ASC
    `).all(params).map(mapIntradayBar);
  },

  listIntradayBarsByRange({ quoteCode, timeframe = '1m', startDay, endDay, limit = 20000 } = {}) {
    const normalizedQuoteCode = String(quoteCode || '').trim().toUpperCase();
    const tf = String(timeframe || '').trim();
    if (!normalizedQuoteCode || !tf) return [];

    const normalizedLimit = Math.min(Math.max(Number(limit) || 20000, 20), 50000);
    const db = getDb();
    const where = [
      'quote_code = @quoteCode',
      'timeframe = @timeframe',
    ];
    const params = {
      quoteCode: normalizedQuoteCode,
      timeframe: tf,
      limit: normalizedLimit,
    };
    if (startDay) {
      where.push('trade_day >= @startDay');
      params.startDay = String(startDay);
    }
    if (endDay) {
      where.push('trade_day <= @endDay');
      params.endDay = String(endDay);
    }

    return db.prepare(`
      SELECT *
      FROM futures_intraday_bars
      WHERE ${where.join(' AND ')}
      ORDER BY bucket_ts ASC
      LIMIT @limit
    `).all(params).map(mapIntradayBar);
  },

  getLatestIntradayTradeDayOverall({ timeframe = '1m', quoteCode } = {}) {
    const tf = String(timeframe || '').trim();
    if (!tf) return null;

    const normalizedQuoteCode = String(quoteCode || '').trim().toUpperCase();
    const db = getDb();
    const where = ['timeframe = @timeframe'];
    const params = { timeframe: tf };
    if (normalizedQuoteCode) {
      where.push('quote_code LIKE @quoteLike');
      params.quoteLike = `%${normalizedQuoteCode}%`;
    }

    const row = db.prepare(`
      SELECT trade_day
      FROM futures_intraday_bars
      WHERE ${where.join(' AND ')}
      ORDER BY trade_day DESC
      LIMIT 1
    `).get(params);
    return row?.trade_day || null;
  },

  countIntradayBarsForReview({ timeframe = '1m', tradeDay, startDay, endDay, quoteCode = '' } = {}) {
    const tf = String(timeframe || '').trim();
    if (!tf) return 0;

    const db = getDb();
    const where = ['timeframe = @timeframe'];
    const params = { timeframe: tf };
    if (tradeDay) {
      where.push('trade_day = @tradeDay');
      params.tradeDay = String(tradeDay);
    } else {
      if (startDay) {
        where.push('trade_day >= @startDay');
        params.startDay = String(startDay);
      }
      if (endDay) {
        where.push('trade_day <= @endDay');
        params.endDay = String(endDay);
      }
    }

    const normalizedQuoteCode = String(quoteCode || '').trim().toUpperCase();
    if (normalizedQuoteCode) {
      where.push('quote_code LIKE @quoteLike');
      params.quoteLike = `%${normalizedQuoteCode}%`;
    }

    const row = db.prepare(`
      SELECT COUNT(*) AS total
      FROM futures_intraday_bars
      WHERE ${where.join(' AND ')}
    `).get(params);

    return Number(row?.total || 0);
  },

  listIntradayBarsForReview({ timeframe = '1m', tradeDay, startDay, endDay, quoteCode = '', page = 1, limit = 200 } = {}) {
    const tf = String(timeframe || '').trim();
    if (!tf) return [];

    const normalizedPage = Math.max(Number(page) || 1, 1);
    const normalizedLimit = Math.min(Math.max(Number(limit) || 200, 20), 1000);
    const offset = (normalizedPage - 1) * normalizedLimit;

    const db = getDb();
    const where = ['timeframe = @timeframe'];
    const params = {
      timeframe: tf,
      limit: normalizedLimit,
      offset,
    };

    if (tradeDay) {
      where.push('trade_day = @tradeDay');
      params.tradeDay = String(tradeDay);
    } else {
      if (startDay) {
        where.push('trade_day >= @startDay');
        params.startDay = String(startDay);
      }
      if (endDay) {
        where.push('trade_day <= @endDay');
        params.endDay = String(endDay);
      }
    }

    const normalizedQuoteCode = String(quoteCode || '').trim().toUpperCase();
    if (normalizedQuoteCode) {
      where.push('quote_code LIKE @quoteLike');
      params.quoteLike = `%${normalizedQuoteCode}%`;
    }

    return db.prepare(`
      SELECT *
      FROM futures_intraday_bars
      WHERE ${where.join(' AND ')}
      ORDER BY bucket_ts DESC, quote_code ASC
      LIMIT @limit OFFSET @offset
    `).all(params).map(mapIntradayBar);
  },

  listIntradaySymbolsOverview({ timeframe = '1m', tradeDay, startDay, endDay, quoteCode = '', limit = 200 } = {}) {
    const tf = String(timeframe || '').trim();
    if (!tf) return [];

    const normalizedLimit = Math.min(Math.max(Number(limit) || 200, 20), 1000);
    const db = getDb();
    const where = ['timeframe = @timeframe'];
    const params = {
      timeframe: tf,
      limit: normalizedLimit,
    };

    if (tradeDay) {
      where.push('trade_day = @tradeDay');
      params.tradeDay = String(tradeDay);
    } else {
      if (startDay) {
        where.push('trade_day >= @startDay');
        params.startDay = String(startDay);
      }
      if (endDay) {
        where.push('trade_day <= @endDay');
        params.endDay = String(endDay);
      }
    }

    const normalizedQuoteCode = String(quoteCode || '').trim().toUpperCase();
    if (normalizedQuoteCode) {
      where.push('quote_code LIKE @quoteLike');
      params.quoteLike = `%${normalizedQuoteCode}%`;
    }

    return db.prepare(`
      WITH base AS (
        SELECT quote_code, bucket_ts, date, updated_at
        FROM futures_intraday_bars
        WHERE ${where.join(' AND ')}
      )
      SELECT
        base.quote_code AS quoteCode,
        COALESCE((
          SELECT fs.name
          FROM futures_symbols fs
          WHERE UPPER(fs.quote_code) = base.quote_code
          ORDER BY fs.is_active DESC, fs.sort_order ASC, fs.id ASC
          LIMIT 1
        ), '') AS symbolName,
        COUNT(*) AS bars,
        MIN(base.bucket_ts) AS firstBucketTs,
        MAX(base.bucket_ts) AS lastBucketTs,
        MIN(base.date) AS firstDate,
        MAX(base.date) AS lastDate,
        MAX(base.updated_at) AS updatedAt
      FROM base
      GROUP BY base.quote_code
      ORDER BY base.quote_code ASC
      LIMIT @limit
    `).all(params);
  },
};

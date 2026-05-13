import { getDb } from '../db/database.js';

function mapEodBar(row) {
  if (!row) return null;
  return {
    stockCode: row.stock_code,
    market: row.market,
    tsCode: row.ts_code,
    timeframe: row.timeframe,
    tradeDay: row.trade_day,
    bucketTs: row.bucket_ts,
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    preClose: row.pre_close,
    change: row.change,
    pctChg: row.pct_chg,
    vol: row.vol,
    amount: row.amount,
    source: row.source,
    syncedAt: row.synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapIntradayBar(row) {
  if (!row) return null;
  return {
    stockCode: row.stock_code,
    market: row.market,
    tsCode: row.ts_code,
    timeframe: row.timeframe,
    tradeDay: row.trade_day,
    bucketTs: row.bucket_ts,
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    preClose: row.pre_close,
    change: row.change,
    pctChg: row.pct_chg,
    vol: row.vol,
    amount: row.amount,
    source: row.source,
    syncedAt: row.synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const stockBarsRepository = {
  listEodBars({ stockCode, timeframe = '1d', startDay, endDay, limit = 240 } = {}) {
    const normalizedCode = String(stockCode || '').trim().toUpperCase();
    if (!normalizedCode) return [];

    const tf = String(timeframe || '1d').trim();
    const where = ['stock_code = @stockCode', 'timeframe = @timeframe'];
    const params = {
      stockCode: normalizedCode,
      timeframe: tf,
      limit: Math.min(Math.max(Number(limit) || 240, 1), 50000),
    };

    if (startDay) {
      where.push('trade_day >= @startDay');
      params.startDay = String(startDay);
    }
    if (endDay) {
      where.push('trade_day <= @endDay');
      params.endDay = String(endDay);
    }

    const db = getDb();
    return db.prepare(`
      SELECT *
      FROM stock_eod_bars
      WHERE ${where.join(' AND ')}
      ORDER BY bucket_ts ASC
      LIMIT @limit
    `).all(params).map(mapEodBar);
  },

  listIntradayBars({ stockCode, timeframe = '1m', tradeDay, startDay, endDay, limit = 1800 } = {}) {
    const normalizedCode = String(stockCode || '').trim().toUpperCase();
    if (!normalizedCode) return [];

    const tf = String(timeframe || '1m').trim();
    const where = ['stock_code = @stockCode', 'timeframe = @timeframe'];
    const params = {
      stockCode: normalizedCode,
      timeframe: tf,
      limit: Math.min(Math.max(Number(limit) || 1800, 1), 50000),
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

    const db = getDb();
    return db.prepare(`
      SELECT *
      FROM stock_intraday_bars
      WHERE ${where.join(' AND ')}
      ORDER BY bucket_ts ASC
      LIMIT @limit
    `).all(params).map(mapIntradayBar);
  },

  getLatestBarTime({ stockCode, timeframe = '1d', intraday = false } = {}) {
    const normalizedCode = String(stockCode || '').trim().toUpperCase();
    if (!normalizedCode) return null;

    const table = intraday ? 'stock_intraday_bars' : 'stock_eod_bars';
    const db = getDb();
    const row = db.prepare(`
      SELECT trade_day, bucket_ts, date
      FROM ${table}
      WHERE stock_code = @stockCode
        AND timeframe = @timeframe
      ORDER BY bucket_ts DESC
      LIMIT 1
    `).get({
      stockCode: normalizedCode,
      timeframe: String(timeframe || '').trim(),
    });
    if (!row) return null;
    return {
      tradeDay: row.trade_day,
      bucketTs: row.bucket_ts,
      date: row.date,
    };
  },

  countIntradayBars({ timeframe = '1m', tradeDay, startDay, endDay, stockCode = '' } = {}) {
    const tf = String(timeframe || '').trim();
    if (!tf) return 0;

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

    const normalizedCode = String(stockCode || '').trim().toUpperCase();
    if (normalizedCode) {
      where.push('stock_code LIKE @stockCodeLike');
      params.stockCodeLike = `%${normalizedCode}%`;
    }

    const db = getDb();
    const row = db.prepare(`
      SELECT COUNT(*) AS total
      FROM stock_intraday_bars
      WHERE ${where.join(' AND ')}
    `).get(params);
    return Number(row?.total || 0);
  },

  listIntradayBarsForReview({ timeframe = '1m', tradeDay, startDay, endDay, stockCode = '', page = 1, limit = 200 } = {}) {
    const tf = String(timeframe || '').trim();
    if (!tf) return [];

    const normalizedPage = Math.max(Number(page) || 1, 1);
    const normalizedLimit = Math.min(Math.max(Number(limit) || 200, 20), 50000);
    const offset = (normalizedPage - 1) * normalizedLimit;

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

    const normalizedStockCode = String(stockCode || '').trim().toUpperCase();
    if (normalizedStockCode) {
      where.push('stock_code LIKE @stockLike');
      params.stockLike = `%${normalizedStockCode}%`;
    }

    const db = getDb();
    return db.prepare(`
      SELECT *
      FROM stock_intraday_bars
      WHERE ${where.join(' AND ')}
      ORDER BY trade_day DESC, bucket_ts DESC, stock_code ASC
      LIMIT @limit OFFSET @offset
    `).all(params).map(mapIntradayBar);
  },

  listIntradaySymbolsOverview({ timeframe = '1m', tradeDay, startDay, endDay, stockCode = '', limit = 200 } = {}) {
    const tf = String(timeframe || '').trim();
    if (!tf) return [];

    const normalizedLimit = Math.min(Math.max(Number(limit) || 200, 20), 50000);
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

    const normalizedStockCode = String(stockCode || '').trim().toUpperCase();
    if (normalizedStockCode) {
      where.push('stock_code LIKE @stockLike');
      params.stockLike = `%${normalizedStockCode}%`;
    }

    const db = getDb();
    return db.prepare(`
      WITH base AS (
        SELECT
          stock_code,
          CASE
            WHEN stock_code GLOB 'SH[0-9][0-9][0-9][0-9][0-9][0-9]' THEN SUBSTR(stock_code, 3)
            WHEN stock_code GLOB 'SZ[0-9][0-9][0-9][0-9][0-9][0-9]' THEN SUBSTR(stock_code, 3)
            WHEN stock_code GLOB 'HK[0-9][0-9][0-9][0-9][0-9]' THEN SUBSTR(stock_code, 3)
            ELSE stock_code
          END AS code_key,
          bucket_ts,
          date,
          updated_at
        FROM stock_intraday_bars
        WHERE ${where.join(' AND ')}
      ),
      basic_names AS (
        SELECT code, MAX(name) AS name
        FROM stock_basics
        WHERE market = 'A'
        GROUP BY code
      )
      SELECT
        base.stock_code AS stockCode,
        COALESCE(MAX(basic_names.name), '') AS symbolName,
        COUNT(*) AS bars,
        MIN(base.bucket_ts) AS firstBucketTs,
        MAX(base.bucket_ts) AS lastBucketTs,
        MIN(base.date) AS firstDate,
        MAX(base.date) AS lastDate,
        MAX(base.updated_at) AS updatedAt
      FROM base
      LEFT JOIN basic_names ON basic_names.code = base.code_key
      GROUP BY base.stock_code
      ORDER BY base.stock_code ASC
      LIMIT @limit
    `).all(params);
  },

  countEodBars({ timeframe = '1d', tradeDay, startDay, endDay, stockCode = '' } = {}) {
    const tf = String(timeframe || '').trim();
    if (!tf) return 0;

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

    const normalizedStockCode = String(stockCode || '').trim().toUpperCase();
    if (normalizedStockCode) {
      where.push('stock_code LIKE @stockCodeLike');
      params.stockCodeLike = `%${normalizedStockCode}%`;
    }

    const db = getDb();
    const row = db.prepare(`
      SELECT COUNT(*) AS total
      FROM stock_eod_bars
      WHERE ${where.join(' AND ')}
    `).get(params);
    return Number(row?.total || 0);
  },

  listEodBarsForReview({ timeframe = '1d', tradeDay, startDay, endDay, stockCode = '', page = 1, limit = 200 } = {}) {
    const tf = String(timeframe || '').trim();
    if (!tf) return [];

    const normalizedPage = Math.max(Number(page) || 1, 1);
    const normalizedLimit = Math.min(Math.max(Number(limit) || 200, 20), 1000);
    const offset = (normalizedPage - 1) * normalizedLimit;

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

    const normalizedStockCode = String(stockCode || '').trim().toUpperCase();
    if (normalizedStockCode) {
      where.push('stock_code LIKE @stockLike');
      params.stockLike = `%${normalizedStockCode}%`;
    }

    const db = getDb();
    return db.prepare(`
      SELECT *
      FROM stock_eod_bars
      WHERE ${where.join(' AND ')}
      ORDER BY trade_day DESC, bucket_ts DESC, stock_code ASC
      LIMIT @limit OFFSET @offset
    `).all(params).map(mapEodBar);
  },

  summarizeEodBars({ timeframe = '1d', tradeDay, startDay, endDay, stockCode = '' } = {}) {
    const tf = String(timeframe || '').trim();
    if (!tf) {
      return {
        totalBars: 0,
        symbolCount: 0,
        firstDate: null,
        lastDate: null,
      };
    }

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

    const normalizedStockCode = String(stockCode || '').trim().toUpperCase();
    if (normalizedStockCode) {
      where.push('stock_code LIKE @stockLike');
      params.stockLike = `%${normalizedStockCode}%`;
    }

    const db = getDb();
    const whereClause = where.join(' AND ');
    const row = db.prepare(`
      SELECT
        (
          SELECT COUNT(*)
          FROM (
            SELECT 1
            FROM stock_eod_bars INDEXED BY idx_stock_eod_bars_tf_day_code
            WHERE ${whereClause}
            GROUP BY stock_code
          ) grouped_symbols
        ) AS symbolCount,
        (
          SELECT MIN(trade_day)
          FROM stock_eod_bars INDEXED BY idx_stock_eod_bars_tf_day
          WHERE ${whereClause}
        ) AS firstDate,
        (
          SELECT MAX(trade_day)
          FROM stock_eod_bars INDEXED BY idx_stock_eod_bars_tf_day
          WHERE ${whereClause}
        ) AS lastDate
    `).get(params);
    return {
      totalBars: 0,
      symbolCount: Number(row?.symbolCount || 0),
      firstDate: row?.firstDate || null,
      lastDate: row?.lastDate || null,
    };
  },

  listEodSymbolsOverview({ timeframe = '1d', tradeDay, startDay, endDay, stockCode = '', limit = 200 } = {}) {
    const tf = String(timeframe || '').trim();
    if (!tf) return [];

    const normalizedLimit = Math.min(Math.max(Number(limit) || 200, 20), 1000);
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

    const normalizedStockCode = String(stockCode || '').trim().toUpperCase();
    if (normalizedStockCode) {
      where.push('stock_code LIKE @stockLike');
      params.stockLike = `%${normalizedStockCode}%`;
    }

    const db = getDb();
    return db.prepare(`
      WITH base AS (
        SELECT
          stock_code,
          CASE
            WHEN stock_code GLOB 'SH[0-9][0-9][0-9][0-9][0-9][0-9]' THEN SUBSTR(stock_code, 3)
            WHEN stock_code GLOB 'SZ[0-9][0-9][0-9][0-9][0-9][0-9]' THEN SUBSTR(stock_code, 3)
            WHEN stock_code GLOB 'HK[0-9][0-9][0-9][0-9][0-9]' THEN SUBSTR(stock_code, 3)
            ELSE stock_code
          END AS code_key,
          bucket_ts,
          date,
          updated_at
        FROM stock_eod_bars
        WHERE ${where.join(' AND ')}
      ),
      basic_names AS (
        SELECT code, MAX(name) AS name
        FROM stock_basics
        WHERE market = 'A'
        GROUP BY code
      )
      SELECT
        base.stock_code AS stockCode,
        COALESCE(MAX(basic_names.name), '') AS symbolName,
        COUNT(*) AS bars,
        MIN(base.bucket_ts) AS firstBucketTs,
        MAX(base.bucket_ts) AS lastBucketTs,
        MIN(base.date) AS firstDate,
        MAX(base.date) AS lastDate,
        MAX(base.updated_at) AS updatedAt
      FROM base
      LEFT JOIN basic_names ON basic_names.code = base.code_key
      GROUP BY base.stock_code
      ORDER BY base.stock_code ASC
      LIMIT @limit
    `).all(params);
  },
};

import { getDb } from '../db/database.js';

function sanitizeInValues(values = [], fallback = []) {
  const source = Array.isArray(values) ? values : [];
  const cleaned = Array.from(new Set(source.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean)));
  if (cleaned.length) return cleaned;
  return Array.from(new Set((Array.isArray(fallback) ? fallback : []).map((item) => String(item || '').trim().toUpperCase()).filter(Boolean)));
}

function toFilterNumber(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && String(value).trim() === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export const stockScreeningRepository = {
  listCandidateBasics({ subMarkets = [], totalMarketCapMin = null, totalMarketCapMax = null, limit = 5000 } = {}) {
    const markets = sanitizeInValues(subMarkets, ['SH', 'SZ', 'BJ']);
    const where = ['market = @market'];
    const params = {
      market: 'A',
      limit: Math.max(1, Math.min(Number(limit) || 5000, 20000)),
    };

    if (markets.length) {
      const placeholders = markets.map((item, idx) => `@subMarket${idx}`);
      where.push(`UPPER(COALESCE(sub_market, '')) IN (${placeholders.join(', ')})`);
      markets.forEach((item, idx) => {
        params[`subMarket${idx}`] = item;
      });
    }

    const capMin = toFilterNumber(totalMarketCapMin);
    if (capMin !== null) {
      where.push('COALESCE(total_market_cap, 0) >= @totalMarketCapMin');
      params.totalMarketCapMin = capMin;
    }

    const capMax = toFilterNumber(totalMarketCapMax);
    if (capMax !== null) {
      where.push('COALESCE(total_market_cap, 0) <= @totalMarketCapMax');
      params.totalMarketCapMax = capMax;
    }

    const db = getDb();
    return db.prepare(`
      SELECT
        id,
        market,
        sub_market,
        code,
        name,
        sector,
        industry,
        listing_date,
        total_market_cap,
        float_market_cap,
        updated_at
      FROM stock_basics
      WHERE ${where.join(' AND ')}
      ORDER BY code ASC
      LIMIT @limit
    `).all(params).map((row) => ({
      id: row.id,
      market: row.market,
      subMarket: row.sub_market,
      code: row.code,
      name: row.name,
      sector: row.sector,
      industry: row.industry,
      listingDate: row.listing_date,
      totalMarketCap: row.total_market_cap,
      floatMarketCap: row.float_market_cap,
      updatedAt: row.updated_at,
    }));
  },

  listEodBarsByCodesAndRange({ codes = [], startDay = '', endDay = '', timeframe = '1d' } = {}) {
    const normalizedCodes = Array.from(new Set((Array.isArray(codes) ? codes : [])
      .map((item) => String(item || '').trim().toUpperCase())
      .filter(Boolean)));
    if (!normalizedCodes.length) return [];

    const db = getDb();
    const chunkSize = 700;
    const result = [];

    for (let offset = 0; offset < normalizedCodes.length; offset += chunkSize) {
      const chunk = normalizedCodes.slice(offset, offset + chunkSize);
      const placeholders = chunk.map((_, idx) => `@code${idx}`);
      const params = {
        timeframe: String(timeframe || '1d').trim() || '1d',
        startDay: String(startDay || '').trim(),
        endDay: String(endDay || '').trim(),
      };
      chunk.forEach((code, idx) => {
        params[`code${idx}`] = code;
      });

      const rows = db.prepare(`
        SELECT
          stock_code,
          trade_day,
          open,
          high,
          low,
          close,
          pre_close,
          change,
          pct_chg,
          vol,
          amount,
          updated_at
        FROM stock_eod_bars
        WHERE timeframe = @timeframe
          AND trade_day >= @startDay
          AND trade_day <= @endDay
          AND stock_code IN (${placeholders.join(', ')})
        ORDER BY stock_code ASC, trade_day ASC
      `).all(params);

      rows.forEach((row) => {
        result.push({
          stockCode: row.stock_code,
          tradeDay: row.trade_day,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          preClose: row.pre_close,
          change: row.change,
          pctChg: row.pct_chg,
          vol: row.vol,
          amount: row.amount,
          updatedAt: row.updated_at,
        });
      });
    }

    return result;
  },

  getLatestTradeDayInRange({ startDay = '', endDay = '', timeframe = '1d' } = {}) {
    const db = getDb();
    const row = db.prepare(`
      SELECT MAX(trade_day) AS latest_day
      FROM stock_eod_bars
      WHERE timeframe = @timeframe
        AND trade_day >= @startDay
        AND trade_day <= @endDay
    `).get({
      timeframe: String(timeframe || '1d').trim() || '1d',
      startDay: String(startDay || '').trim(),
      endDay: String(endDay || '').trim(),
    });

    return row?.latest_day ? String(row.latest_day) : '';
  },
};

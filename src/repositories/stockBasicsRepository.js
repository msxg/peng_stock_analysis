import { getDb } from '../db/database.js';
import { getOfficialStockTradingHours } from '../utils/tradingHours.js';

function mapBasic(row) {
  if (!row) return null;
  return {
    id: row.id,
    market: row.market,
    subMarket: row.sub_market,
    code: row.code,
    name: row.name,
    sector: row.sector,
    industry: row.industry,
    latestPrice: row.latest_price,
    totalShares: row.total_shares,
    floatShares: row.float_shares,
    totalMarketCap: row.total_market_cap,
    floatMarketCap: row.float_market_cap,
    listingDate: row.listing_date,
    mainBusiness: row.main_business,
    businessScope: row.business_scope,
    companyProfile: row.company_profile,
    tradingHours: getOfficialStockTradingHours({
      market: row.market,
      subMarket: row.sub_market,
    }) || null,
    fundamentalsSource: row.fundamentals_source,
    fundamentalsSyncedAt: row.fundamentals_synced_at,
    source: row.source,
    syncedAt: row.synced_at,
    updatedAt: row.updated_at,
  };
}

function toBasicUpsertParams(row = {}) {
  return {
    market: row.market,
    subMarket: row.subMarket ?? null,
    code: row.code,
    name: row.name,
    sector: row.sector ?? null,
    industry: row.industry ?? null,
    latestPrice: row.latestPrice ?? null,
    totalShares: row.totalShares ?? null,
    floatShares: row.floatShares ?? null,
    totalMarketCap: row.totalMarketCap ?? null,
    floatMarketCap: row.floatMarketCap ?? null,
    listingDate: row.listingDate ?? null,
    mainBusiness: row.mainBusiness ?? null,
    businessScope: row.businessScope ?? null,
    companyProfile: row.companyProfile ?? null,
    tradingHours: getOfficialStockTradingHours(row) ?? null,
    fundamentalsSource: row.fundamentalsSource ?? null,
    fundamentalsSyncedAt: row.fundamentalsSyncedAt ?? null,
    source: row.source ?? null,
    syncedAt: row.syncedAt ?? null,
  };
}

export const stockBasicsRepository = {
  countAll() {
    const db = getDb();
    return db.prepare('SELECT COUNT(1) AS total FROM stock_basics').get()?.total || 0;
  },

  upsertMany(items = []) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO stock_basics (
        market, sub_market, code, name, sector, industry,
        latest_price, total_shares, float_shares, total_market_cap, float_market_cap,
        listing_date, main_business, business_scope, company_profile, trading_hours,
        fundamentals_source, fundamentals_synced_at,
        source, synced_at, updated_at
      )
      VALUES (
        @market, @subMarket, @code, @name, @sector, @industry,
        @latestPrice, @totalShares, @floatShares, @totalMarketCap, @floatMarketCap,
        @listingDate, @mainBusiness, @businessScope, @companyProfile, @tradingHours,
        @fundamentalsSource, @fundamentalsSyncedAt,
        @source, @syncedAt, datetime('now')
      )
      ON CONFLICT(market, code) DO UPDATE SET
        sub_market = excluded.sub_market,
        name = excluded.name,
        sector = excluded.sector,
        industry = COALESCE(excluded.industry, stock_basics.industry),
        latest_price = COALESCE(excluded.latest_price, stock_basics.latest_price),
        total_shares = COALESCE(excluded.total_shares, stock_basics.total_shares),
        float_shares = COALESCE(excluded.float_shares, stock_basics.float_shares),
        total_market_cap = COALESCE(excluded.total_market_cap, stock_basics.total_market_cap),
        float_market_cap = COALESCE(excluded.float_market_cap, stock_basics.float_market_cap),
        listing_date = COALESCE(excluded.listing_date, stock_basics.listing_date),
        main_business = COALESCE(excluded.main_business, stock_basics.main_business),
        business_scope = COALESCE(excluded.business_scope, stock_basics.business_scope),
        company_profile = COALESCE(excluded.company_profile, stock_basics.company_profile),
        trading_hours = excluded.trading_hours,
        fundamentals_source = COALESCE(excluded.fundamentals_source, stock_basics.fundamentals_source),
        fundamentals_synced_at = COALESCE(excluded.fundamentals_synced_at, stock_basics.fundamentals_synced_at),
        source = excluded.source,
        synced_at = excluded.synced_at,
        updated_at = datetime('now')
    `);

    const tx = db.transaction((rows) => {
      rows.forEach((row) => stmt.run(toBasicUpsertParams(row)));
    });
    tx(items);
  },

  upsertFundamentals(item = {}) {
    if (!item?.market || !item?.code) return;
    const db = getDb();
    db.prepare(`
      INSERT INTO stock_basics (
        market, sub_market, code, name, sector, industry,
        latest_price, total_shares, float_shares, total_market_cap, float_market_cap,
        listing_date, main_business, business_scope, company_profile, trading_hours,
        fundamentals_source, fundamentals_synced_at,
        source, synced_at, updated_at
      )
      VALUES (
        @market, @subMarket, @code, @name, @sector, @industry,
        @latestPrice, @totalShares, @floatShares, @totalMarketCap, @floatMarketCap,
        @listingDate, @mainBusiness, @businessScope, @companyProfile, @tradingHours,
        @fundamentalsSource, @fundamentalsSyncedAt,
        @source, @syncedAt, datetime('now')
      )
      ON CONFLICT(market, code) DO UPDATE SET
        sub_market = COALESCE(excluded.sub_market, stock_basics.sub_market),
        name = COALESCE(excluded.name, stock_basics.name),
        sector = COALESCE(excluded.sector, stock_basics.sector),
        industry = COALESCE(excluded.industry, stock_basics.industry),
        latest_price = COALESCE(excluded.latest_price, stock_basics.latest_price),
        total_shares = COALESCE(excluded.total_shares, stock_basics.total_shares),
        float_shares = COALESCE(excluded.float_shares, stock_basics.float_shares),
        total_market_cap = COALESCE(excluded.total_market_cap, stock_basics.total_market_cap),
        float_market_cap = COALESCE(excluded.float_market_cap, stock_basics.float_market_cap),
        listing_date = COALESCE(excluded.listing_date, stock_basics.listing_date),
        main_business = COALESCE(excluded.main_business, stock_basics.main_business),
        business_scope = COALESCE(excluded.business_scope, stock_basics.business_scope),
        company_profile = COALESCE(excluded.company_profile, stock_basics.company_profile),
        trading_hours = excluded.trading_hours,
        fundamentals_source = COALESCE(excluded.fundamentals_source, stock_basics.fundamentals_source),
        fundamentals_synced_at = COALESCE(excluded.fundamentals_synced_at, stock_basics.fundamentals_synced_at),
        source = COALESCE(excluded.source, stock_basics.source),
        synced_at = COALESCE(excluded.synced_at, stock_basics.synced_at),
        updated_at = datetime('now')
    `).run(toBasicUpsertParams(item));
  },

  search({ q = '', market = '', limit = 50, offset = 0 } = {}) {
    const db = getDb();
    const where = ['1 = 1'];
    const params = {
      limit: Math.max(1, Math.min(Number(limit) || 50, 500)),
      offset: Math.max(0, Number(offset) || 0),
    };

    if (market) {
      where.push('market = @market');
      params.market = String(market).trim().toUpperCase();
    }

    if (q) {
      where.push('(code LIKE @q OR name LIKE @q)');
      params.q = `%${String(q).trim()}%`;
    }

    const total = db.prepare(`
      SELECT COUNT(1) AS total
      FROM stock_basics
      WHERE ${where.join(' AND ')}
    `).get(params)?.total || 0;

    const items = db.prepare(`
      SELECT *
      FROM stock_basics
      WHERE ${where.join(' AND ')}
      ORDER BY market ASC, code ASC
      LIMIT @limit OFFSET @offset
    `).all(params).map(mapBasic);

    return {
      total,
      items,
      limit: params.limit,
      offset: params.offset,
    };
  },

  findByCode(code) {
    const db = getDb();
    const rows = db.prepare(`
      SELECT *
      FROM stock_basics
      WHERE code = ?
      ORDER BY
        CASE market
          WHEN 'A' THEN 1
          WHEN 'HK' THEN 2
          WHEN 'US' THEN 3
          ELSE 99
        END ASC
      LIMIT 5
    `).all(String(code || '').trim().toUpperCase());
    return rows.map(mapBasic);
  },

  findByMarketAndCode(market, code) {
    const db = getDb();
    const row = db.prepare(`
      SELECT *
      FROM stock_basics
      WHERE market = ? AND code = ?
      LIMIT 1
    `).get(String(market || '').trim().toUpperCase(), String(code || '').trim().toUpperCase());
    return mapBasic(row);
  },

  listByMarket(market) {
    const db = getDb();
    return db.prepare(`
      SELECT *
      FROM stock_basics
      WHERE market = ?
      ORDER BY code ASC
    `).all(String(market || '').trim().toUpperCase()).map(mapBasic);
  },

  getMarketQualityStats(market) {
    const db = getDb();
    const row = db.prepare(`
      SELECT
        COUNT(1) AS total,
        SUM(CASE WHEN COALESCE(industry, '') <> '' OR COALESCE(sector, '') <> '' THEN 1 ELSE 0 END) AS with_industry,
        SUM(CASE WHEN COALESCE(listing_date, '') <> '' THEN 1 ELSE 0 END) AS with_listing_date,
        SUM(CASE WHEN COALESCE(main_business, '') <> '' THEN 1 ELSE 0 END) AS with_main_business,
        SUM(CASE WHEN COALESCE(business_scope, '') <> '' THEN 1 ELSE 0 END) AS with_business_scope,
        SUM(CASE WHEN total_shares IS NOT NULL AND total_shares > 0 THEN 1 ELSE 0 END) AS with_total_shares,
        SUM(CASE WHEN float_shares IS NOT NULL AND float_shares > 0 THEN 1 ELSE 0 END) AS with_float_shares,
        SUM(CASE WHEN total_market_cap IS NOT NULL AND total_market_cap > 0 THEN 1 ELSE 0 END) AS with_total_market_cap,
        SUM(CASE WHEN float_market_cap IS NOT NULL AND float_market_cap > 0 THEN 1 ELSE 0 END) AS with_float_market_cap
      FROM stock_basics
      WHERE market = ?
    `).get(String(market || '').trim().toUpperCase());

    const total = Number(row?.total || 0);
    const pct = (count) => (total > 0 ? Number(((Number(count || 0) / total) * 100).toFixed(2)) : 0);
    return {
      total,
      withIndustry: Number(row?.with_industry || 0),
      withIndustryPct: pct(row?.with_industry),
      withListingDate: Number(row?.with_listing_date || 0),
      withListingDatePct: pct(row?.with_listing_date),
      withMainBusiness: Number(row?.with_main_business || 0),
      withMainBusinessPct: pct(row?.with_main_business),
      withBusinessScope: Number(row?.with_business_scope || 0),
      withBusinessScopePct: pct(row?.with_business_scope),
      withTotalShares: Number(row?.with_total_shares || 0),
      withTotalSharesPct: pct(row?.with_total_shares),
      withFloatShares: Number(row?.with_float_shares || 0),
      withFloatSharesPct: pct(row?.with_float_shares),
      withTotalMarketCap: Number(row?.with_total_market_cap || 0),
      withTotalMarketCapPct: pct(row?.with_total_market_cap),
      withFloatMarketCap: Number(row?.with_float_market_cap || 0),
      withFloatMarketCapPct: pct(row?.with_float_market_cap),
    };
  },
};

import { getDb } from '../db/database.js';

function mapSignalRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    batchId: row.batch_id,
    analysisMode: row.analysis_mode,
    sourceMode: row.source_mode,
    poolId: row.pool_id,
    poolCode: row.pool_code,
    poolName: row.pool_name,
    indexCode: row.index_code,
    indexName: row.index_name,
    analysisDate: row.analysis_date,
    signalDate: row.signal_date,
    stockCode: row.stock_code,
    stockName: row.stock_name,
    signalSide: row.signal_side,
    signalType: row.signal_type,
    signalPrice: row.signal_price,
    signalReason: row.signal_reason,
    signalPnlPct: row.signal_pnl_pct,
    paramsJson: row.params_json,
    createdAt: row.created_at,
  };
}

export const bluechipAnalysisResultRepository = {
  insertSignals(items = []) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO bluechip_analysis_signals (
        batch_id, analysis_mode, source_mode,
        pool_id, pool_code, pool_name,
        index_code, index_name,
        analysis_date, signal_date,
        stock_code, stock_name,
        signal_side, signal_type,
        signal_price, signal_reason, signal_pnl_pct,
        params_json, created_at
      ) VALUES (
        @batchId, @analysisMode, @sourceMode,
        @poolId, @poolCode, @poolName,
        @indexCode, @indexName,
        @analysisDate, @signalDate,
        @stockCode, @stockName,
        @signalSide, @signalType,
        @signalPrice, @signalReason, @signalPnlPct,
        @paramsJson, datetime('now')
      )
    `);

    const tx = db.transaction((rows) => {
      rows.forEach((row) => stmt.run(row));
    });

    tx(Array.isArray(items) ? items : []);
    return Array.isArray(items) ? items.length : 0;
  },

  listSignals({
    analysisMode = '',
    poolCode = '',
    batchId = '',
    keyword = '',
    dateFrom = '',
    dateTo = '',
    limit = 100,
    offset = 0,
  } = {}) {
    const db = getDb();
    const where = [];
    const params = {
      limit: Math.max(1, Math.min(1000, Number(limit) || 100)),
      offset: Math.max(0, Number(offset) || 0),
    };

    const normalizedMode = String(analysisMode || '').trim().toLowerCase();
    if (normalizedMode) {
      where.push('analysis_mode = @analysisMode');
      params.analysisMode = normalizedMode;
    }

    const normalizedPoolCode = String(poolCode || '').trim().toUpperCase();
    if (normalizedPoolCode) {
      where.push('pool_code = @poolCode');
      params.poolCode = normalizedPoolCode;
    }

    const normalizedBatchId = String(batchId || '').trim();
    if (normalizedBatchId) {
      where.push('batch_id = @batchId');
      params.batchId = normalizedBatchId;
    }

    const normalizedDateFrom = String(dateFrom || '').trim();
    if (normalizedDateFrom) {
      where.push('analysis_date >= @dateFrom');
      params.dateFrom = normalizedDateFrom;
    }

    const normalizedDateTo = String(dateTo || '').trim();
    if (normalizedDateTo) {
      where.push('analysis_date <= @dateTo');
      params.dateTo = normalizedDateTo;
    }

    const normalizedKeyword = String(keyword || '').trim();
    if (normalizedKeyword) {
      where.push(`(
        stock_code LIKE @keyword
        OR stock_name LIKE @keyword
        OR signal_type LIKE @keyword
        OR signal_reason LIKE @keyword
        OR pool_name LIKE @keyword
      )`);
      params.keyword = `%${normalizedKeyword}%`;
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalRow = db.prepare(`
      SELECT COUNT(1) AS total
      FROM bluechip_analysis_signals
      ${whereSql}
    `).get(params);

    const rows = db.prepare(`
      SELECT *
      FROM bluechip_analysis_signals
      ${whereSql}
      ORDER BY signal_date DESC, id DESC
      LIMIT @limit OFFSET @offset
    `).all(params);

    return {
      total: Number(totalRow?.total || 0),
      items: rows.map(mapSignalRow),
    };
  },

  listBatches({
    analysisMode = '',
    poolCode = '',
    keyword = '',
    dateFrom = '',
    dateTo = '',
    limit = 100,
    offset = 0,
  } = {}) {
    const db = getDb();
    const where = [];
    const params = {
      limit: Math.max(1, Math.min(500, Number(limit) || 100)),
      offset: Math.max(0, Number(offset) || 0),
    };

    const normalizedMode = String(analysisMode || '').trim().toLowerCase();
    if (normalizedMode) {
      where.push('analysis_mode = @analysisMode');
      params.analysisMode = normalizedMode;
    }

    const normalizedPoolCode = String(poolCode || '').trim().toUpperCase();
    if (normalizedPoolCode) {
      where.push('pool_code = @poolCode');
      params.poolCode = normalizedPoolCode;
    }

    const normalizedDateFrom = String(dateFrom || '').trim();
    if (normalizedDateFrom) {
      where.push('analysis_date >= @dateFrom');
      params.dateFrom = normalizedDateFrom;
    }

    const normalizedDateTo = String(dateTo || '').trim();
    if (normalizedDateTo) {
      where.push('analysis_date <= @dateTo');
      params.dateTo = normalizedDateTo;
    }

    const normalizedKeyword = String(keyword || '').trim();
    if (normalizedKeyword) {
      where.push(`(
        batch_id LIKE @keyword
        OR pool_name LIKE @keyword
        OR pool_code LIKE @keyword
      )`);
      params.keyword = `%${normalizedKeyword}%`;
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalRow = db.prepare(`
      SELECT COUNT(1) AS total
      FROM (
        SELECT batch_id
        FROM bluechip_analysis_signals
        ${whereSql}
        GROUP BY batch_id
      ) t
    `).get(params);

    const rows = db.prepare(`
      SELECT
        batch_id,
        MAX(analysis_mode) AS analysis_mode,
        MAX(source_mode) AS source_mode,
        MAX(pool_code) AS pool_code,
        MAX(pool_name) AS pool_name,
        MAX(index_code) AS index_code,
        MAX(index_name) AS index_name,
        MAX(analysis_date) AS analysis_date,
        COUNT(1) AS signal_count,
        COUNT(DISTINCT stock_code) AS stock_count,
        MAX(created_at) AS created_at
      FROM bluechip_analysis_signals
      ${whereSql}
      GROUP BY batch_id
      ORDER BY MAX(created_at) DESC
      LIMIT @limit OFFSET @offset
    `).all(params);

    return {
      total: Number(totalRow?.total || 0),
      items: rows.map((row) => ({
        batchId: row.batch_id,
        analysisMode: row.analysis_mode,
        sourceMode: row.source_mode,
        poolCode: row.pool_code,
        poolName: row.pool_name,
        indexCode: row.index_code,
        indexName: row.index_name,
        analysisDate: row.analysis_date,
        signalCount: Number(row.signal_count || 0),
        stockCount: Number(row.stock_count || 0),
        createdAt: row.created_at,
      })),
    };
  },
};

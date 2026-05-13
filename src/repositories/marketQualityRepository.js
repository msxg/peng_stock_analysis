import { getDb } from '../db/database.js';

function mapReport(row) {
  if (!row) return null;
  return {
    id: row.id,
    datasetName: row.dataset_name,
    symbolType: row.symbol_type,
    market: row.market,
    timeframe: row.timeframe,
    scopeType: row.scope_type,
    scopeKey: row.scope_key,
    startDate: row.start_date,
    endDate: row.end_date,
    totalExpected: row.total_expected,
    totalActual: row.total_actual,
    gapCount: row.gap_count,
    anomalyCount: row.anomaly_count,
    coverageRatio: row.coverage_ratio,
    reportJson: row.report_json,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
  };
}

export const marketQualityRepository = {
  createReport(payload = {}) {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO market_data_quality_reports (
        dataset_name, symbol_type, market, timeframe, scope_type, scope_key,
        start_date, end_date, total_expected, total_actual, gap_count, anomaly_count,
        coverage_ratio, report_json, generated_at, created_at
      ) VALUES (
        @datasetName, @symbolType, @market, @timeframe, @scopeType, @scopeKey,
        @startDate, @endDate, @totalExpected, @totalActual, @gapCount, @anomalyCount,
        @coverageRatio, @reportJson, COALESCE(@generatedAt, datetime('now')), datetime('now')
      )
    `).run({
      datasetName: payload.datasetName,
      symbolType: payload.symbolType || null,
      market: payload.market || null,
      timeframe: payload.timeframe,
      scopeType: payload.scopeType || 'range',
      scopeKey: payload.scopeKey || null,
      startDate: payload.startDate || null,
      endDate: payload.endDate || null,
      totalExpected: Number(payload.totalExpected || 0),
      totalActual: Number(payload.totalActual || 0),
      gapCount: Number(payload.gapCount || 0),
      anomalyCount: Number(payload.anomalyCount || 0),
      coverageRatio: Number.isFinite(Number(payload.coverageRatio)) ? Number(payload.coverageRatio) : null,
      reportJson: payload.reportJson || null,
      generatedAt: payload.generatedAt || null,
    });
    return this.getById(result.lastInsertRowid);
  },

  getById(id) {
    const db = getDb();
    return mapReport(db.prepare('SELECT * FROM market_data_quality_reports WHERE id = ?').get(id));
  },

  listReports({ datasetName, timeframe, scopeType, limit = 50 } = {}) {
    const where = ['1 = 1'];
    const params = { limit: Math.min(Math.max(Number(limit) || 50, 1), 500) };

    if (datasetName) {
      where.push('dataset_name = @datasetName');
      params.datasetName = String(datasetName);
    }
    if (timeframe) {
      where.push('timeframe = @timeframe');
      params.timeframe = String(timeframe);
    }
    if (scopeType) {
      where.push('scope_type = @scopeType');
      params.scopeType = String(scopeType);
    }

    const db = getDb();
    return db.prepare(`
      SELECT *
      FROM market_data_quality_reports
      WHERE ${where.join(' AND ')}
      ORDER BY id DESC
      LIMIT @limit
    `).all(params).map(mapReport);
  },
};

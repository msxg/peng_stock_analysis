import { getDb } from '../db/database.js';
import { nowLocalDateTime } from '../utils/date.js';

function mapJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobType: row.job_type,
    triggerType: row.trigger_type,
    marketScope: row.market_scope,
    datasetScope: row.dataset_scope,
    symbolType: row.symbol_type,
    timeframe: row.timeframe,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    requestedBy: row.requested_by,
    paramsJson: row.params_json,
    summaryJson: row.summary_json,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapJobItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    symbolCode: row.symbol_code,
    quoteCode: row.quote_code,
    symbolType: row.symbol_type,
    market: row.market,
    timeframe: row.timeframe,
    rangeStart: row.range_start,
    rangeEnd: row.range_end,
    sourceProvider: row.source_provider,
    status: row.status,
    barsWritten: row.bars_written,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const marketSyncJobRepository = {
  createJob(payload = {}) {
    const db = getDb();
    const now = nowLocalDateTime();
    const result = db.prepare(`
      INSERT INTO market_sync_jobs (
        job_type, trigger_type, market_scope, dataset_scope, symbol_type, timeframe,
        start_date, end_date, status, requested_by, params_json, summary_json,
        started_at, finished_at, created_at, updated_at
      ) VALUES (
        @jobType, @triggerType, @marketScope, @datasetScope, @symbolType, @timeframe,
        @startDate, @endDate, @status, @requestedBy, @paramsJson, @summaryJson,
        @startedAt, @finishedAt, @createdAt, @updatedAt
      )
    `).run({
      jobType: payload.jobType || 'sync',
      triggerType: payload.triggerType || 'manual',
      marketScope: payload.marketScope || 'both',
      datasetScope: payload.datasetScope || null,
      symbolType: payload.symbolType || null,
      timeframe: payload.timeframe || null,
      startDate: payload.startDate || null,
      endDate: payload.endDate || null,
      status: payload.status || 'queued',
      requestedBy: payload.requestedBy || null,
      paramsJson: payload.paramsJson || null,
      summaryJson: payload.summaryJson || null,
      startedAt: payload.startedAt || null,
      finishedAt: payload.finishedAt || null,
      createdAt: now,
      updatedAt: now,
    });
    return this.getJobById(result.lastInsertRowid);
  },

  getJobById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM market_sync_jobs WHERE id = ?').get(id);
    return mapJob(row);
  },

  updateJob(id, patch = {}) {
    const db = getDb();
    const fields = [];
    const params = { id };

    const mapping = {
      status: 'status',
      summaryJson: 'summary_json',
      startedAt: 'started_at',
      finishedAt: 'finished_at',
      paramsJson: 'params_json',
    };
    Object.entries(mapping).forEach(([key, column]) => {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        fields.push(`${column} = @${key}`);
        params[key] = patch[key] ?? null;
      }
    });

    if (!fields.length) return this.getJobById(id);
    params.updatedAt = nowLocalDateTime();

    db.prepare(`
      UPDATE market_sync_jobs
      SET ${fields.join(', ')},
          updated_at = @updatedAt
      WHERE id = @id
    `).run(params);

    return this.getJobById(id);
  },

  createJobItem(payload = {}) {
    const db = getDb();
    const now = nowLocalDateTime();
    const result = db.prepare(`
      INSERT INTO market_sync_job_items (
        job_id, symbol_code, quote_code, symbol_type, market, timeframe,
        range_start, range_end, source_provider, status, bars_written,
        error_code, error_message, started_at, finished_at, created_at, updated_at
      ) VALUES (
        @jobId, @symbolCode, @quoteCode, @symbolType, @market, @timeframe,
        @rangeStart, @rangeEnd, @sourceProvider, @status, @barsWritten,
        @errorCode, @errorMessage, @startedAt, @finishedAt, @createdAt, @updatedAt
      )
    `).run({
      jobId: payload.jobId,
      symbolCode: payload.symbolCode || null,
      quoteCode: payload.quoteCode || null,
      symbolType: payload.symbolType || null,
      market: payload.market || null,
      timeframe: payload.timeframe || null,
      rangeStart: payload.rangeStart || null,
      rangeEnd: payload.rangeEnd || null,
      sourceProvider: payload.sourceProvider || null,
      status: payload.status || 'queued',
      barsWritten: Number(payload.barsWritten || 0),
      errorCode: payload.errorCode || null,
      errorMessage: payload.errorMessage || null,
      startedAt: payload.startedAt || null,
      finishedAt: payload.finishedAt || null,
      createdAt: now,
      updatedAt: now,
    });

    return this.getJobItemById(result.lastInsertRowid);
  },

  getJobItemById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM market_sync_job_items WHERE id = ?').get(id);
    return mapJobItem(row);
  },

  updateJobItem(id, patch = {}) {
    const db = getDb();
    const fields = [];
    const params = { id };

    const mapping = {
      status: 'status',
      sourceProvider: 'source_provider',
      barsWritten: 'bars_written',
      errorCode: 'error_code',
      errorMessage: 'error_message',
      startedAt: 'started_at',
      finishedAt: 'finished_at',
    };

    Object.entries(mapping).forEach(([key, column]) => {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        fields.push(`${column} = @${key}`);
        params[key] = patch[key] ?? null;
      }
    });

    if (!fields.length) return this.getJobItemById(id);
    params.updatedAt = nowLocalDateTime();

    db.prepare(`
      UPDATE market_sync_job_items
      SET ${fields.join(', ')},
          updated_at = @updatedAt
      WHERE id = @id
    `).run(params);

    return this.getJobItemById(id);
  },

  listJobs({ page = 1, limit = 20, status, jobType } = {}) {
    const normalizedPage = Math.max(Number(page) || 1, 1);
    const normalizedLimit = Math.min(Math.max(Number(limit) || 20, 1), 200);
    const offset = (normalizedPage - 1) * normalizedLimit;

    const where = ['1 = 1'];
    const params = {
      limit: normalizedLimit,
      offset,
    };

    if (status) {
      where.push('status = @status');
      params.status = String(status);
    }
    if (jobType) {
      where.push('job_type = @jobType');
      params.jobType = String(jobType);
    }

    const db = getDb();
    const total = Number(db.prepare(`
      SELECT COUNT(*) AS total
      FROM market_sync_jobs
      WHERE ${where.join(' AND ')}
    `).get(params)?.total || 0);

    const items = db.prepare(`
      SELECT *
      FROM market_sync_jobs
      WHERE ${where.join(' AND ')}
      ORDER BY id DESC
      LIMIT @limit OFFSET @offset
    `).all(params).map(mapJob);

    return {
      items,
      pagination: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
        totalPages: total > 0 ? Math.ceil(total / normalizedLimit) : 0,
      },
    };
  },

  listJobItems(jobId) {
    const db = getDb();
    return db.prepare(`
      SELECT *
      FROM market_sync_job_items
      WHERE job_id = ?
      ORDER BY id ASC
    `).all(jobId).map(mapJobItem);
  },
};

import { getDb } from '../db/database.js';

function parseJson(text, fallback = null) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export const analysisRepository = {
  createTask(task) {
    const db = getDb();
    db.prepare(`
      INSERT INTO analysis_tasks (task_id, query_id, stock_codes, status, params, created_at, updated_at)
      VALUES (@taskId, @queryId, @stockCodes, @status, @params, datetime('now'), datetime('now'))
    `).run({
      taskId: task.taskId,
      queryId: task.queryId,
      stockCodes: JSON.stringify(task.stockCodes),
      status: task.status,
      params: JSON.stringify(task.params || {}),
    });
  },

  updateTask(taskId, patch) {
    const db = getDb();
    db.prepare(`
      UPDATE analysis_tasks
      SET status = COALESCE(@status, status),
          result = COALESCE(@result, result),
          error = COALESCE(@error, error),
          updated_at = datetime('now'),
          completed_at = CASE WHEN @status IN ('completed', 'failed') THEN datetime('now') ELSE completed_at END
      WHERE task_id = @taskId
    `).run({
      taskId,
      status: patch.status || null,
      result: patch.result ? JSON.stringify(patch.result) : null,
      error: patch.error || null,
    });
  },

  getTask(taskId) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM analysis_tasks WHERE task_id = ?').get(taskId);
    if (!row) return null;
    return {
      taskId: row.task_id,
      queryId: row.query_id,
      stockCodes: parseJson(row.stock_codes, []),
      status: row.status,
      params: parseJson(row.params, {}),
      result: parseJson(row.result, null),
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    };
  },

  listTasks(limit = 50, status = undefined) {
    const db = getDb();
    const query = status
      ? 'SELECT * FROM analysis_tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?'
      : 'SELECT * FROM analysis_tasks ORDER BY created_at DESC LIMIT ?';
    const rows = status ? db.prepare(query).all(status, limit) : db.prepare(query).all(limit);
    return rows.map((row) => ({
      taskId: row.task_id,
      queryId: row.query_id,
      stockCodes: parseJson(row.stock_codes, []),
      status: row.status,
      params: parseJson(row.params, {}),
      result: parseJson(row.result, null),
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    }));
  },

  createHistory(item) {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO analysis_history (
        query_id, stock_code, stock_name, market, analysis_date,
        summary, recommendation, buy_price, stop_loss, target_price,
        confidence, technical_payload, news_payload, report_markdown
      ) VALUES (
        @queryId, @stockCode, @stockName, @market, @analysisDate,
        @summary, @recommendation, @buyPrice, @stopLoss, @targetPrice,
        @confidence, @technicalPayload, @newsPayload, @reportMarkdown
      )
    `).run({
      queryId: item.queryId,
      stockCode: item.stockCode,
      stockName: item.stockName || item.stockCode,
      market: item.market,
      analysisDate: item.analysisDate,
      summary: item.summary,
      recommendation: item.recommendation,
      buyPrice: item.buyPrice,
      stopLoss: item.stopLoss,
      targetPrice: item.targetPrice,
      confidence: item.confidence,
      technicalPayload: JSON.stringify(item.technical || {}),
      newsPayload: JSON.stringify(item.news || []),
      reportMarkdown: item.reportMarkdown,
    });

    return this.getHistoryById(result.lastInsertRowid);
  },

  listHistory({ page = 1, limit = 20, startDate, endDate, stockCode }) {
    const db = getDb();
    const where = ['1 = 1'];
    const params = {};

    if (startDate) {
      where.push('analysis_date >= @startDate');
      params.startDate = startDate;
    }
    if (endDate) {
      where.push('analysis_date <= @endDate');
      params.endDate = endDate;
    }
    if (stockCode) {
      where.push('stock_code = @stockCode');
      params.stockCode = stockCode;
    }

    const whereSql = where.join(' AND ');

    const total = db.prepare(`SELECT COUNT(1) as count FROM analysis_history WHERE ${whereSql}`).get(params).count;
    const offset = (page - 1) * limit;

    const rows = db
      .prepare(`
        SELECT * FROM analysis_history
        WHERE ${whereSql}
        ORDER BY analysis_date DESC, id DESC
        LIMIT @limit OFFSET @offset
      `)
      .all({ ...params, limit, offset });

    return {
      total,
      page,
      limit,
      items: rows.map((row) => ({
        id: row.id,
        queryId: row.query_id,
        stockCode: row.stock_code,
        stockName: row.stock_name,
        market: row.market,
        analysisDate: row.analysis_date,
        summary: row.summary,
        recommendation: row.recommendation,
        buyPrice: row.buy_price,
        stopLoss: row.stop_loss,
        targetPrice: row.target_price,
        confidence: row.confidence,
        createdAt: row.created_at,
      })),
    };
  },

  getHistoryById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM analysis_history WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id,
      queryId: row.query_id,
      stockCode: row.stock_code,
      stockName: row.stock_name,
      market: row.market,
      analysisDate: row.analysis_date,
      summary: row.summary,
      recommendation: row.recommendation,
      buyPrice: row.buy_price,
      stopLoss: row.stop_loss,
      targetPrice: row.target_price,
      confidence: row.confidence,
      technical: parseJson(row.technical_payload, {}),
      news: parseJson(row.news_payload, []),
      reportMarkdown: row.report_markdown,
      createdAt: row.created_at,
    };
  },

  deleteHistoryByIds(ids) {
    if (!ids.length) return 0;
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    const result = db.prepare(`DELETE FROM analysis_history WHERE id IN (${placeholders})`).run(...ids);
    return result.changes;
  },

  listHistoryRawForBacktest(stockCode = null, limit = 500) {
    const db = getDb();
    const query = stockCode
      ? 'SELECT * FROM analysis_history WHERE stock_code = ? ORDER BY analysis_date DESC LIMIT ?'
      : 'SELECT * FROM analysis_history ORDER BY analysis_date DESC LIMIT ?';
    const rows = stockCode ? db.prepare(query).all(stockCode, limit) : db.prepare(query).all(limit);
    return rows.map((row) => ({
      id: row.id,
      stockCode: row.stock_code,
      analysisDate: row.analysis_date,
      recommendation: row.recommendation,
      buyPrice: row.buy_price,
      targetPrice: row.target_price,
      stopLoss: row.stop_loss,
      confidence: row.confidence,
    }));
  },

  clearBacktestResults(evaluationDays, stockCode = null) {
    const db = getDb();
    if (stockCode) {
      db.prepare('DELETE FROM backtest_results WHERE evaluation_days = ? AND stock_code = ?').run(evaluationDays, stockCode);
      return;
    }
    db.prepare('DELETE FROM backtest_results WHERE evaluation_days = ?').run(evaluationDays);
  },

  insertBacktestResult(item) {
    const db = getDb();
    db.prepare(`
      INSERT INTO backtest_results (
        analysis_id, stock_code, evaluation_days, start_price, end_price, return_pct, direction_hit, tp_hit, sl_hit
      ) VALUES (
        @analysisId, @stockCode, @evaluationDays, @startPrice, @endPrice, @returnPct, @directionHit, @tpHit, @slHit
      )
    `).run({
      analysisId: item.analysisId,
      stockCode: item.stockCode,
      evaluationDays: item.evaluationDays,
      startPrice: item.startPrice,
      endPrice: item.endPrice,
      returnPct: item.returnPct,
      directionHit: item.directionHit ? 1 : 0,
      tpHit: item.tpHit ? 1 : 0,
      slHit: item.slHit ? 1 : 0,
    });
  },

  listBacktestResults({ stockCode, evaluationDays, page = 1, limit = 50 }) {
    const db = getDb();
    const where = ['1 = 1'];
    const params = {};
    if (stockCode) {
      where.push('r.stock_code = @stockCode');
      params.stockCode = stockCode;
    }
    if (evaluationDays) {
      where.push('r.evaluation_days = @evaluationDays');
      params.evaluationDays = evaluationDays;
    }

    const whereSql = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(1) as count FROM backtest_results r WHERE ${whereSql}`).get(params).count;
    const offset = (page - 1) * limit;

    const rows = db.prepare(`
      SELECT r.*, h.analysis_date, h.recommendation, h.summary
      FROM backtest_results r
      JOIN analysis_history h ON h.id = r.analysis_id
      WHERE ${whereSql}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit, offset });

    return {
      total,
      page,
      limit,
      items: rows.map((row) => ({
        id: row.id,
        analysisId: row.analysis_id,
        stockCode: row.stock_code,
        evaluationDays: row.evaluation_days,
        startPrice: row.start_price,
        endPrice: row.end_price,
        returnPct: row.return_pct,
        directionHit: Boolean(row.direction_hit),
        tpHit: Boolean(row.tp_hit),
        slHit: Boolean(row.sl_hit),
        analysisDate: row.analysis_date,
        recommendation: row.recommendation,
        summary: row.summary,
        createdAt: row.created_at,
      })),
    };
  },

  summarizeBacktest(evaluationDays) {
    const db = getDb();
    const row = db.prepare(`
      SELECT
        COUNT(1) AS total,
        AVG(return_pct) AS avg_return,
        SUM(CASE WHEN return_pct > 0 THEN 1 ELSE 0 END) AS positive_count,
        AVG(CASE WHEN direction_hit = 1 THEN 1.0 ELSE 0.0 END) AS direction_hit_rate,
        AVG(CASE WHEN tp_hit = 1 THEN 1.0 ELSE 0.0 END) AS tp_hit_rate,
        AVG(CASE WHEN sl_hit = 1 THEN 1.0 ELSE 0.0 END) AS sl_hit_rate
      FROM backtest_results
      WHERE evaluation_days = ?
    `).get(evaluationDays);

    return {
      total: row?.total || 0,
      avgReturnPct: Number((row?.avg_return || 0).toFixed(2)),
      winRate: row?.total ? Number(((row.positive_count / row.total) * 100).toFixed(2)) : 0,
      directionHitRate: Number(((row?.direction_hit_rate || 0) * 100).toFixed(2)),
      takeProfitHitRate: Number(((row?.tp_hit_rate || 0) * 100).toFixed(2)),
      stopLossHitRate: Number(((row?.sl_hit_rate || 0) * 100).toFixed(2)),
    };
  },

  summarizeBacktestByStock(evaluationDays) {
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        stock_code,
        COUNT(1) AS total,
        AVG(return_pct) AS avg_return,
        SUM(CASE WHEN return_pct > 0 THEN 1 ELSE 0 END) AS positive_count,
        AVG(CASE WHEN direction_hit = 1 THEN 1.0 ELSE 0.0 END) AS direction_hit_rate,
        AVG(CASE WHEN tp_hit = 1 THEN 1.0 ELSE 0.0 END) AS tp_hit_rate,
        AVG(CASE WHEN sl_hit = 1 THEN 1.0 ELSE 0.0 END) AS sl_hit_rate
      FROM backtest_results
      WHERE evaluation_days = ?
      GROUP BY stock_code
      ORDER BY avg_return DESC
    `).all(evaluationDays);

    return rows.map((row) => ({
      stockCode: row.stock_code,
      total: row.total,
      avgReturnPct: Number((row.avg_return || 0).toFixed(2)),
      winRate: row.total ? Number(((row.positive_count / row.total) * 100).toFixed(2)) : 0,
      directionHitRate: Number(((row.direction_hit_rate || 0) * 100).toFixed(2)),
      takeProfitHitRate: Number(((row.tp_hit_rate || 0) * 100).toFixed(2)),
      stopLossHitRate: Number(((row.sl_hit_rate || 0) * 100).toFixed(2)),
    }));
  },

  logUsage(item) {
    const db = getDb();
    db.prepare(`
      INSERT INTO usage_logs (event_type, model, token_in, token_out, cost, created_at)
      VALUES (@eventType, @model, @tokenIn, @tokenOut, @cost, datetime('now'))
    `).run({
      eventType: item.eventType,
      model: item.model || 'local',
      tokenIn: item.tokenIn || 0,
      tokenOut: item.tokenOut || 0,
      cost: item.cost || 0,
    });
  },

  getUsageSummary(startDate, endDate) {
    const db = getDb();
    const row = db.prepare(`
      SELECT
        COUNT(1) AS total_events,
        SUM(token_in) AS total_token_in,
        SUM(token_out) AS total_token_out,
        SUM(cost) AS total_cost
      FROM usage_logs
      WHERE created_at >= ? AND created_at <= ?
    `).get(startDate, endDate);

    const modelRows = db.prepare(`
      SELECT model, COUNT(1) as count, SUM(token_in + token_out) as tokens, SUM(cost) as cost
      FROM usage_logs
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY model
      ORDER BY count DESC
    `).all(startDate, endDate);

    return {
      totalEvents: row?.total_events || 0,
      totalTokenIn: row?.total_token_in || 0,
      totalTokenOut: row?.total_token_out || 0,
      totalCost: Number((row?.total_cost || 0).toFixed(4)),
      byModel: modelRows.map((item) => ({
        model: item.model,
        count: item.count,
        tokens: item.tokens || 0,
        cost: Number((item.cost || 0).toFixed(4)),
      })),
    };
  },
};

import { HttpError } from '../utils/httpError.js';
import { stockDataService } from '../services/stockDataService.js';
import { blueChipModeService, BLUE_CHIP_DEFAULT_PARAMS } from '../services/blueChipModeService.js';
import { bluechipPoolService } from '../services/bluechipPoolService.js';
import { bluechipAnalysisResultService } from '../services/bluechipAnalysisResultService.js';
import { normalizeStockCode, parseStockList } from '../utils/stockCode.js';

const AVERAGE_PRICE_INDEX_CODE = 'AVG_CN';
const AVERAGE_PRICE_INDEX_NAME = '平均股价';

function parseDays(input) {
  const n = Number(input);
  if (!Number.isFinite(n)) return BLUE_CHIP_DEFAULT_PARAMS.days;
  return Math.max(30, Math.min(1000, Math.round(n)));
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function buildAverageIndexHistory(shHistory = [], szHistory = []) {
  const shMap = new Map((Array.isArray(shHistory) ? shHistory : []).map((item) => [String(item?.date || ''), item]));
  const szMap = new Map((Array.isArray(szHistory) ? szHistory : []).map((item) => [String(item?.date || ''), item]));
  const dates = Array.from(shMap.keys()).filter((date) => date && szMap.has(date)).sort();
  return dates.map((date) => {
    const sh = shMap.get(date) || {};
    const sz = szMap.get(date) || {};
    return {
      date,
      open: round((toNum(sh.open) + toNum(sz.open)) / 2, 4),
      high: round((toNum(sh.high) + toNum(sz.high)) / 2, 4),
      low: round((toNum(sh.low) + toNum(sz.low)) / 2, 4),
      close: round((toNum(sh.close) + toNum(sz.close)) / 2, 4),
      volume: round((toNum(sh.volume) + toNum(sz.volume)) / 2, 2),
    };
  });
}

async function resolveIndexRaw(indexCode, { days, includeTodayRealtime = false } = {}) {
  const normalized = String(indexCode || AVERAGE_PRICE_INDEX_CODE).trim().toUpperCase() || AVERAGE_PRICE_INDEX_CODE;
  if (normalized === AVERAGE_PRICE_INDEX_CODE) {
    const [shRaw, szRaw] = await Promise.all([
      stockDataService.getHistory('SH000001', { days, includeTodayRealtime }),
      stockDataService.getHistory('SZ399001', { days, includeTodayRealtime }),
    ]);
    const averageHistory = buildAverageIndexHistory(shRaw.history || [], szRaw.history || []);
    if (!averageHistory.length) {
      throw new HttpError(502, '平均股价指数数据为空');
    }
    return {
      code: AVERAGE_PRICE_INDEX_CODE,
      quote: {
        stockCode: AVERAGE_PRICE_INDEX_CODE,
        stockName: AVERAGE_PRICE_INDEX_NAME,
        market: 'CN_INDEX',
        dataSource: `${shRaw.quote?.dataSource || 'unknown'} + ${szRaw.quote?.dataSource || 'unknown'}`,
      },
      history: averageHistory,
    };
  }

  const indexRaw = await stockDataService.getHistory(normalized, { days, includeTodayRealtime });
  return {
    code: normalized,
    quote: indexRaw.quote || {},
    history: indexRaw.history || [],
  };
}

async function pickBatchCodes(payload = {}) {
  const mode = String(payload.mode || 'manual').trim().toLowerCase();
  if (mode === 'pool') {
    const poolCode = String(payload.poolCode || '').trim().toUpperCase();
    const resolved = bluechipPoolService.resolvePoolMembers(poolCode);
    return {
      mode: 'pool',
      poolId: resolved.poolId,
      poolCode: resolved.poolCode,
      poolName: resolved.poolName,
      codes: resolved.codes,
      codeNameMap: resolved.codeNameMap || {},
    };
  }

  const codes = parseStockList(payload.codesText || payload.codes || '')
    .map((item) => normalizeStockCode(item))
    .filter((item) => /^\d{6}$/.test(item) || /^(SH|SZ)\d{6}$/.test(item));

  return {
    mode: 'manual',
    poolId: null,
    poolCode: '',
    poolName: '',
    codes: Array.from(new Set(codes)),
    codeNameMap: {},
  };
}

export const blueChipModeController = {
  defaults(_req, res) {
    res.json({
      defaults: BLUE_CHIP_DEFAULT_PARAMS,
      batchPools: bluechipPoolService.listPoolSummaries({ onlyEnabled: true }),
    });
  },

  async analyze(req, res) {
    const payload = req.body || {};
    const stockCode = String(payload.stockCode || '').trim();
    const indexCode = String(payload.indexCode || AVERAGE_PRICE_INDEX_CODE).trim().toUpperCase() || AVERAGE_PRICE_INDEX_CODE;
    if (!stockCode) {
      throw new HttpError(400, 'stockCode 不能为空');
    }

    const days = parseDays(payload.days ?? payload.params?.days);
    const analysisMode = String(payload.analysisMode || 'today').trim().toLowerCase() === 'history' ? 'history' : 'today';
    const includeTodayRealtime = analysisMode === 'today';
    const stockRaw = await stockDataService.getHistory(stockCode, {
      days,
      includeTodayRealtime,
    });
    const indexRaw = await resolveIndexRaw(indexCode, { days, includeTodayRealtime });

    const analysis = blueChipModeService.analyze({
      stockCode,
      indexCode: indexRaw.code,
      stockHistory: stockRaw.history || [],
      indexHistory: indexRaw.history || [],
      params: {
        ...(payload.params || {}),
        days,
      },
    });

    res.json({
      stock: {
        code: stockRaw.quote?.stockCode || stockCode,
        name: stockRaw.quote?.stockName || stockCode,
        market: stockRaw.quote?.market || null,
        dataSource: stockRaw.quote?.dataSource || null,
      },
      index: {
        code: indexRaw.quote?.stockCode || indexRaw.code || indexCode,
        name: indexRaw.quote?.stockName || indexRaw.code || indexCode,
        market: indexRaw.quote?.market || null,
        dataSource: indexRaw.quote?.dataSource || null,
      },
      analysis,
      failOpen: true,
    });
  },

  async batchAnalyze(req, res) {
    const payload = req.body || {};
    const indexCode = String(payload.indexCode || AVERAGE_PRICE_INDEX_CODE).trim().toUpperCase() || AVERAGE_PRICE_INDEX_CODE;
    const analysisMode = String(payload.analysisMode || 'history').trim().toLowerCase() === 'today' ? 'today' : 'history';
    const days = parseDays(payload.days ?? payload.params?.days);
    const concurrency = Math.max(1, Math.min(8, Math.round(Number(payload.concurrency) || 3)));
    const picked = await pickBatchCodes(payload);
    if (!picked.codes.length) {
      throw new HttpError(400, '未提供有效股票代码');
    }
    const limitedCodes = picked.codes.slice(0, 500);

    const includeTodayRealtime = analysisMode === 'today';
    const indexRaw = await resolveIndexRaw(indexCode, { days, includeTodayRealtime });
    const tasks = limitedCodes.map((code) => async () => {
      try {
        const stockRaw = await stockDataService.getHistory(code, {
          days,
          includeTodayRealtime,
        });
        const analysis = blueChipModeService.analyze({
          stockCode: code,
          indexCode: indexRaw.code,
          stockHistory: stockRaw.history || [],
          indexHistory: indexRaw.history || [],
          params: {
            ...(payload.params || {}),
            days,
          },
        });
        const signals = Array.isArray(analysis.signals) ? analysis.signals : [];
        const today = String(analysis.stockCandles?.[analysis.stockCandles.length - 1]?.date || '').trim();
        const todaySignals = today ? signals.filter((item) => item.date === today) : [];
        const latestSignal = signals.length ? signals[signals.length - 1] : null;
        const quoteName = String(stockRaw.quote?.stockName || '').trim();
        const preferredName = picked.codeNameMap?.[code];
        const resolvedName = quoteName && quoteName !== code
          ? quoteName
          : (preferredName || quoteName || code);
        return {
          ok: true,
          code: stockRaw.quote?.stockCode || code,
          name: resolvedName,
          market: stockRaw.quote?.market || null,
          dataSource: stockRaw.quote?.dataSource || null,
          signalCount: signals.length,
          hasSignal: signals.length > 0,
          hasTodaySignal: todaySignals.length > 0,
          today,
          todaySignals,
          latestSignal,
          summary: analysis.summary || null,
          signals,
        };
      } catch (error) {
        return {
          ok: false,
          code,
          name: code,
          signalCount: 0,
          hasSignal: false,
          hasTodaySignal: false,
          today: null,
          todaySignals: [],
          latestSignal: null,
          summary: null,
          signals: [],
          error: String(error?.message || '分析失败'),
        };
      }
    });

    const results = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }).map(async () => {
      while (cursor < tasks.length) {
        const taskIndex = cursor;
        cursor += 1;
        const item = await tasks[taskIndex]();
        results.push(item);
      }
    });
    await Promise.all(workers);

    results.sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
    const allSignals = results
      .filter((item) => item.ok)
      .flatMap((item) => (Array.isArray(item.signals) ? item.signals.map((sig) => ({
        code: item.code,
        name: item.name,
        market: item.market || null,
        date: sig.date,
        side: sig.side,
        type: sig.type,
        price: sig.price,
        reason: sig.reason,
        pnlPct: sig.pnlPct ?? null,
      })) : []))
      .sort((a, b) => {
        if (a.date === b.date) return String(a.code || '').localeCompare(String(b.code || ''));
        return String(b.date || '').localeCompare(String(a.date || ''));
      });
    const signals = analysisMode === 'today'
      ? allSignals.filter((item) => item.date && results.some((stock) => stock.code === item.code && stock.today === item.date))
      : allSignals;

    const successCount = results.filter((item) => item.ok).length;
    const failedCount = results.length - successCount;
    const hasSignalCount = results.filter((item) => item.ok && item.hasSignal).length;
    const hasTodaySignalCount = results.filter((item) => item.ok && item.hasTodaySignal).length;

    res.json({
      index: {
        code: indexRaw.quote?.stockCode || indexRaw.code || indexCode,
        name: indexRaw.quote?.stockName || indexRaw.code || indexCode,
        market: indexRaw.quote?.market || null,
        dataSource: indexRaw.quote?.dataSource || null,
      },
      request: {
        analysisMode,
        mode: picked.mode,
        poolId: picked.poolId,
        poolCode: picked.poolCode,
        poolName: picked.poolName,
        totalRequested: picked.codes.length,
        totalAnalyzed: limitedCodes.length,
        days,
        concurrency,
      },
      stats: {
        total: results.length,
        success: successCount,
        failed: failedCount,
        withSignal: hasSignalCount,
        withTodaySignal: hasTodaySignalCount,
      },
      signals,
      stocks: results.map((item) => ({
        code: item.code,
        name: item.name,
        market: item.market || null,
        dataSource: item.dataSource || null,
        ok: item.ok,
        hasSignal: item.hasSignal,
        hasTodaySignal: item.hasTodaySignal,
        signalCount: item.signalCount,
        today: item.today,
        todaySignals: item.todaySignals,
        latestSignal: item.latestSignal,
        summary: item.summary,
        error: item.error || null,
      })),
    });
  },

  saveBatchSignals(req, res) {
    const payload = req.body || {};
    const saved = bluechipAnalysisResultService.saveSignals(payload);
    res.status(201).json(saved);
  },

  listSavedSignals(req, res) {
    const payload = bluechipAnalysisResultService.listSignals(req.query || {});
    res.json(payload);
  },

  listSavedBatches(req, res) {
    const payload = bluechipAnalysisResultService.listBatches(req.query || {});
    res.json(payload);
  },
};

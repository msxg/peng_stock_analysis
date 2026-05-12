import { HttpError } from '../utils/httpError.js';
import { bluechipAnalysisResultRepository } from '../repositories/bluechipAnalysisResultRepository.js';

function normalizeMode(value, fallback = 'history') {
  const mode = String(value || fallback).trim().toLowerCase();
  return mode === 'today' ? 'today' : 'history';
}

function normalizeDate(value = '') {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  return text;
}

function detectAnalysisDate(signals = []) {
  const dates = (Array.isArray(signals) ? signals : [])
    .map((item) => normalizeDate(item?.date || item?.signalDate || ''))
    .filter(Boolean)
    .sort();
  if (dates.length) return dates[dates.length - 1];
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeCode(value = '') {
  return normalizeText(value).toUpperCase();
}

function normalizeSignalSide(value = '') {
  const side = normalizeText(value).toLowerCase();
  return side === 'buy' ? 'buy' : 'sell';
}

function normalizeNumeric(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBatchId(analysisDate) {
  const stamp = Date.now().toString(36).toUpperCase();
  return `BC_${String(analysisDate || '').replace(/-/g, '')}_${stamp}`;
}

export const bluechipAnalysisResultService = {
  saveSignals(payload = {}) {
    const request = payload?.request || payload?.meta?.request || {};
    const index = payload?.index || payload?.meta?.index || {};
    const signals = Array.isArray(payload?.signals) ? payload.signals : [];

    if (!signals.length) {
      throw new HttpError(400, '当前没有可保存的信号数据');
    }

    const analysisMode = normalizeMode(request.analysisMode, payload?.analysisMode);
    const sourceMode = String(request.mode || payload?.sourceMode || 'manual').trim().toLowerCase() === 'pool'
      ? 'pool'
      : 'manual';
    const analysisDate = normalizeDate(payload?.analysisDate) || detectAnalysisDate(signals);
    const batchId = normalizeText(payload?.batchId) || toBatchId(analysisDate);

    const paramsJson = JSON.stringify(payload?.params || request?.params || payload?.analysisParams || {});
    const poolIdNum = Number(request.poolId);
    const poolId = Number.isFinite(poolIdNum) && poolIdNum > 0 ? poolIdNum : null;

    const rows = signals
      .map((item) => {
        const signalDate = normalizeDate(item?.date || item?.signalDate || '');
        const stockCode = normalizeCode(item?.code || item?.stockCode || '');
        const signalType = normalizeText(item?.type || item?.signalType || '');
        if (!signalDate || !stockCode || !signalType) {
          return null;
        }
        return {
          batchId,
          analysisMode,
          sourceMode,
          poolId,
          poolCode: normalizeCode(request.poolCode || payload?.poolCode || ''),
          poolName: normalizeText(request.poolName || payload?.poolName || ''),
          indexCode: normalizeCode(index.code || request.indexCode || payload?.indexCode || ''),
          indexName: normalizeText(index.name || request.indexName || payload?.indexName || ''),
          analysisDate,
          signalDate,
          stockCode,
          stockName: normalizeText(item?.name || item?.stockName || ''),
          signalSide: normalizeSignalSide(item?.side || item?.signalSide || ''),
          signalType,
          signalPrice: normalizeNumeric(item?.price, null),
          signalReason: normalizeText(item?.reason || item?.signalReason || ''),
          signalPnlPct: normalizeNumeric(item?.pnlPct ?? item?.signalPnlPct, null),
          paramsJson,
        };
      })
      .filter(Boolean);

    if (!rows.length) {
      throw new HttpError(400, '信号数据格式不完整，无法保存');
    }

    const insertedCount = bluechipAnalysisResultRepository.insertSignals(rows);
    return {
      batchId,
      analysisDate,
      insertedCount,
      totalSignals: rows.length,
      analysisMode,
      sourceMode,
      poolCode: normalizeCode(request.poolCode || payload?.poolCode || ''),
      poolName: normalizeText(request.poolName || payload?.poolName || ''),
      indexCode: normalizeCode(index.code || request.indexCode || payload?.indexCode || ''),
      indexName: normalizeText(index.name || request.indexName || payload?.indexName || ''),
    };
  },

  listSignals(query = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.max(1, Math.min(500, Number(query.pageSize) || 100));
    const offset = (page - 1) * pageSize;

    const payload = bluechipAnalysisResultRepository.listSignals({
      analysisMode: query.analysisMode,
      poolCode: query.poolCode,
      batchId: query.batchId,
      keyword: query.keyword,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      limit: pageSize,
      offset,
    });

    return {
      page,
      pageSize,
      total: payload.total,
      items: payload.items,
    };
  },

  listBatches(query = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.max(1, Math.min(200, Number(query.pageSize) || 50));
    const offset = (page - 1) * pageSize;

    const payload = bluechipAnalysisResultRepository.listBatches({
      analysisMode: query.analysisMode,
      poolCode: query.poolCode,
      keyword: query.keyword,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      limit: pageSize,
      offset,
    });

    return {
      page,
      pageSize,
      total: payload.total,
      items: payload.items,
    };
  },
};

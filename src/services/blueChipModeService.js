import { normalizeStockCode } from '../utils/stockCode.js';

export const BLUE_CHIP_DEFAULT_PARAMS = {
  days: 180,
  indexDropPct: 10,
  stockStartDropPct: 10,
  indexStartCandlePct: 1.5,
  stopLossPct: 5,
  takeProfitPct: 15,
  mediumBullPctMain: 4,
  longBullPctMain: 6,
  mediumBullPctGrowth: 7,
  longBullPctGrowth: 10,
  failPrevHighDays: 8,
  longHalfReferenceMode: 'first_long_bull_after_start_buy',
};

function toNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function mergeParams(params = {}) {
  const longHalfReferenceMode = String(params.longHalfReferenceMode || BLUE_CHIP_DEFAULT_PARAMS.longHalfReferenceMode).trim();
  return {
    days: Math.max(30, Math.min(1000, Math.round(toNum(params.days, BLUE_CHIP_DEFAULT_PARAMS.days)))),
    indexDropPct: Math.max(1, Math.min(30, toNum(params.indexDropPct, BLUE_CHIP_DEFAULT_PARAMS.indexDropPct))),
    stockStartDropPct: Math.max(1, Math.min(30, toNum(params.stockStartDropPct, BLUE_CHIP_DEFAULT_PARAMS.stockStartDropPct))),
    indexStartCandlePct: Math.max(0.5, Math.min(8, toNum(params.indexStartCandlePct, BLUE_CHIP_DEFAULT_PARAMS.indexStartCandlePct))),
    stopLossPct: Math.max(1, Math.min(20, toNum(params.stopLossPct, BLUE_CHIP_DEFAULT_PARAMS.stopLossPct))),
    takeProfitPct: Math.max(2, Math.min(50, toNum(params.takeProfitPct, BLUE_CHIP_DEFAULT_PARAMS.takeProfitPct))),
    mediumBullPctMain: Math.max(1, Math.min(15, toNum(params.mediumBullPctMain, BLUE_CHIP_DEFAULT_PARAMS.mediumBullPctMain))),
    longBullPctMain: Math.max(2, Math.min(20, toNum(params.longBullPctMain, BLUE_CHIP_DEFAULT_PARAMS.longBullPctMain))),
    mediumBullPctGrowth: Math.max(1, Math.min(20, toNum(params.mediumBullPctGrowth, BLUE_CHIP_DEFAULT_PARAMS.mediumBullPctGrowth))),
    longBullPctGrowth: Math.max(2, Math.min(30, toNum(params.longBullPctGrowth, BLUE_CHIP_DEFAULT_PARAMS.longBullPctGrowth))),
    failPrevHighDays: Math.max(3, Math.min(60, Math.round(toNum(params.failPrevHighDays, BLUE_CHIP_DEFAULT_PARAMS.failPrevHighDays)))),
    longHalfReferenceMode:
      longHalfReferenceMode === 'first_long_bull_after_start_buy'
        ? 'first_long_bull_after_start_buy'
        : 'recent_long_bull',
  };
}

function round(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function pct(base, value) {
  if (!Number.isFinite(base) || base === 0 || !Number.isFinite(value)) return 0;
  return ((value - base) / base) * 100;
}

function rollingHigh(rows = [], start, end) {
  let highest = null;
  for (let i = start; i <= end; i += 1) {
    const row = rows[i];
    if (!row) continue;
    if (highest == null || row.high > highest) highest = row.high;
  }
  return highest;
}

function enrichRows(rows = []) {
  return rows
    .filter((row) => row && row.date)
    .map((row, idx, list) => {
      const prevClose = idx > 0 ? Number(list[idx - 1]?.close) : Number(row.close);
      const open = Number(row.open);
      const close = Number(row.close);
      const high = Number(row.high);
      const low = Number(row.low);
      return {
        ...row,
        open,
        high,
        low,
        close,
        prevClose,
        bodyPct: prevClose ? ((close - open) / prevClose) * 100 : 0,
        changePct: pct(prevClose, close),
        bodyMid: (open + close) / 2,
      };
    })
    .filter((row) => Number.isFinite(row.open) && Number.isFinite(row.high) && Number.isFinite(row.low) && Number.isFinite(row.close));
}

function detectStageStartSignals(rows = [], {
  dropPct = 10,
  bullPct = 1.5,
  reasonPrefix = '阶段回撤',
} = {}) {
  const normalizedRows = enrichRows(rows);
  const result = [];
  let stageHigh = normalizedRows[0]?.close || null;
  let stageHighDate = normalizedRows[0]?.date || '';
  let armed = false;
  let armedMaxDrawdownPct = 0;
  let armedStartDate = '';

  normalizedRows.forEach((row) => {
    if (!Number.isFinite(stageHigh) || row.close > stageHigh) {
      stageHigh = row.close;
      stageHighDate = row.date;
    }

    const drawdownPct = stageHigh > 0 ? ((stageHigh - row.close) / stageHigh) * 100 : 0;
    if (!armed && drawdownPct >= dropPct) {
      armed = true;
      armedMaxDrawdownPct = drawdownPct;
      armedStartDate = stageHighDate || row.date;
    } else if (armed) {
      armedMaxDrawdownPct = Math.max(armedMaxDrawdownPct, drawdownPct);
    }

    const isStrongBull = row.bodyPct >= bullPct;
    if (armed && isStrongBull) {
      const stageDrawdownPct = Math.max(armedMaxDrawdownPct, drawdownPct);
      result.push({
        date: row.date,
        startDate: armedStartDate || stageHighDate || '',
        drawdownPct: round(stageDrawdownPct),
        bodyPct: round(row.bodyPct),
        changePct: round(row.changePct),
        reason: `${reasonPrefix}${round(stageDrawdownPct)}%(起点:${armedStartDate || stageHighDate || '--'})后出现首根中阳`,
      });
      armed = false;
      armedMaxDrawdownPct = 0;
      armedStartDate = '';
      stageHigh = row.close;
      stageHighDate = row.date;
    }
  });

  return result;
}

const SIGNAL_TEXT_MAP = {
  index_linked_start_buy: '指数联动起涨买点',
  stock_independent_start_buy: '个股独立起涨买点',
  stop_loss: '止损卖点',
  take_profit: '止盈卖点',
  break_medium: '跌破中阳',
  lose_long_half: '跌破长阳半体',
  fail_prev_high: '不过前高',
};

function createMarker(signal) {
  const text = SIGNAL_TEXT_MAP[signal?.type] || signal?.type || '';
  if (!signal?.date) return null;
  if (signal.side === 'buy') {
    return {
      time: signal.date,
      position: 'belowBar',
      color: '#16a34a',
      shape: 'arrowUp',
      text,
    };
  }
  return {
    time: signal.date,
    position: 'aboveBar',
    color: '#dc2626',
    shape: 'arrowDown',
    text,
  };
}

export function resolveBoardProfile(stockCode = '') {
  const normalized = normalizeStockCode(stockCode);
  const core = normalized.replace(/^(SH|SZ)/, '');
  const growth = /^300|^301|^688/.test(core);
  return {
    code: normalized,
    boardType: growth ? 'growth' : 'main',
  };
}

export function buildBlueChipModeAnalysis({
  stockCode,
  indexCode,
  stockHistory = [],
  indexHistory = [],
  params = {},
} = {}) {
  const normalizedStockCode = normalizeStockCode(stockCode || '');
  const normalizedIndexCode = normalizeStockCode(indexCode || 'SH000300');
  const paramsUsed = mergeParams(params);
  const boardProfile = resolveBoardProfile(normalizedStockCode);

  const mediumBullPct = boardProfile.boardType === 'growth'
    ? paramsUsed.mediumBullPctGrowth
    : paramsUsed.mediumBullPctMain;
  const longBullPct = boardProfile.boardType === 'growth'
    ? paramsUsed.longBullPctGrowth
    : paramsUsed.longBullPctMain;

  const stockRows = enrichRows(stockHistory).slice(-paramsUsed.days);
  const indexRows = enrichRows(indexHistory).slice(-paramsUsed.days);

  const indexStartSignals = detectStageStartSignals(indexRows, {
    dropPct: paramsUsed.indexDropPct,
    bullPct: paramsUsed.indexStartCandlePct,
    reasonPrefix: '指数回撤',
  });
  const stockStartSignals = detectStageStartSignals(stockRows, {
    dropPct: paramsUsed.stockStartDropPct,
    bullPct: mediumBullPct,
    reasonPrefix: '个股回撤',
  });
  const indexStartDateSet = new Set(indexStartSignals.map((item) => item.date));
  const stockStartDateSet = new Set(stockStartSignals.map((item) => item.date));

  const signals = [];
  const trades = [];

  let latestMediumLow = null;
  let latestMediumDate = '';
  let latestLongHalf = null;
  let latestLongDate = '';
  let position = null;

  stockRows.forEach((row, i) => {
    const lookbackHigh = rollingHigh(stockRows, 0, i - 1);

    let buySignal = null;

    if (!position) {
      if (indexStartDateSet.has(row.date)) {
        const linked = indexStartSignals.find((item) => item.date === row.date);
        buySignal = {
          date: row.date,
          side: 'buy',
          type: 'index_linked_start_buy',
          price: round(row.close),
          reason: linked?.reason || '指数出现起涨买点，同步执行起涨买入',
        };
      } else if (stockStartDateSet.has(row.date)) {
        const independent = stockStartSignals.find((item) => item.date === row.date);
        buySignal = {
          date: row.date,
          side: 'buy',
          type: 'stock_independent_start_buy',
          price: round(row.close),
          reason: independent?.reason || '个股出现独立起涨买点',
        };
      }
    }

    if (!position && buySignal) {
      position = {
        entryDate: row.date,
        entryPrice: row.close,
        entryIndex: i,
        entryPrevHigh: Number.isFinite(lookbackHigh) ? lookbackHigh : row.high,
        maxCloseSinceEntry: row.close,
        firstLongHalfAfterEntry: null,
        firstLongDateAfterEntry: '',
      };
      signals.push(buySignal);
    }

    if (position && i > position.entryIndex) {
      position.maxCloseSinceEntry = Math.max(position.maxCloseSinceEntry, row.close);
      const pnlPct = pct(position.entryPrice, row.close);
      let sellType = '';
      let sellReason = '';
      const useFirstLongAfterStart = paramsUsed.longHalfReferenceMode === 'first_long_bull_after_start_buy';
      const currentLongHalf = useFirstLongAfterStart
        ? position.firstLongHalfAfterEntry
        : latestLongHalf;
      const currentLongDate = useFirstLongAfterStart
        ? position.firstLongDateAfterEntry
        : latestLongDate;

      if (pnlPct <= -paramsUsed.stopLossPct) {
        sellType = 'stop_loss';
        sellReason = `触发止损 ${round(paramsUsed.stopLossPct)}%`; 
      } else if (pnlPct >= paramsUsed.takeProfitPct) {
        sellType = 'take_profit';
        sellReason = `触发止盈 ${round(paramsUsed.takeProfitPct)}%`;
      } else if (Number.isFinite(latestMediumLow) && row.close < latestMediumLow) {
        sellType = 'break_medium';
        sellReason = `跌破最近中阳低点(${latestMediumDate})`;
      } else if (Number.isFinite(currentLongHalf) && row.close < currentLongHalf) {
        sellType = 'lose_long_half';
        sellReason = useFirstLongAfterStart
          ? `跌破起涨后首根长阳半实体(${currentLongDate})`
          : `跌破最近长阳半实体(${currentLongDate})`;
      } else if (
        i - position.entryIndex >= paramsUsed.failPrevHighDays
        && Number.isFinite(position.entryPrevHigh)
        && position.maxCloseSinceEntry < position.entryPrevHigh
      ) {
        sellType = 'fail_prev_high';
        sellReason = `持仓${paramsUsed.failPrevHighDays}天仍未过前高`;
      }

      if (sellType) {
        const sellSignal = {
          date: row.date,
          side: 'sell',
          type: sellType,
          price: round(row.close),
          reason: sellReason,
          pnlPct: round(pnlPct),
        };
        signals.push(sellSignal);
        trades.push({
          entryDate: position.entryDate,
          entryPrice: round(position.entryPrice),
          exitDate: row.date,
          exitPrice: round(row.close),
          pnlPct: round(pnlPct),
          exitType: sellType,
        });
        position = null;
      }
    }

    if (row.bodyPct >= mediumBullPct && row.close > row.open) {
      latestMediumLow = row.low;
      latestMediumDate = row.date;
    }

    if (row.bodyPct >= longBullPct && row.close > row.open) {
      latestLongHalf = row.bodyMid;
      latestLongDate = row.date;
      if (position && !Number.isFinite(position.firstLongHalfAfterEntry)) {
        position.firstLongHalfAfterEntry = row.bodyMid;
        position.firstLongDateAfterEntry = row.date;
      }
    }
  });

  const markers = signals.map(createMarker).filter(Boolean);
  const summary = {
    trades: trades.length,
    wins: trades.filter((item) => Number(item.pnlPct) > 0).length,
    losses: trades.filter((item) => Number(item.pnlPct) <= 0).length,
    avgReturnPct: round(trades.reduce((sum, item) => sum + Number(item.pnlPct || 0), 0) / (trades.length || 1)),
    winRatePct: round((trades.filter((item) => Number(item.pnlPct) > 0).length / (trades.length || 1)) * 100),
    openPosition: position
      ? {
        entryDate: position.entryDate,
        entryPrice: round(position.entryPrice),
        latestPrice: round(stockRows[stockRows.length - 1]?.close),
        floatingPnlPct: round(pct(position.entryPrice, stockRows[stockRows.length - 1]?.close)),
      }
      : null,
  };

  return {
    stockCode: normalizedStockCode,
    indexCode: normalizedIndexCode,
    paramsUsed,
    boardProfile,
    thresholds: {
      mediumBullPct,
      longBullPct,
    },
    indexStartSignals,
    stockStartSignals,
    signals,
    trades,
    markers,
    summary,
    stockCandles: stockRows.map((row) => ({
      time: row.date,
      date: row.date,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      value: Number(row.volume || 0),
    })),
    indexCandles: indexRows.map((row) => ({
      date: row.date,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
    })),
  };
}

export const blueChipModeService = {
  analyze({ stockCode, indexCode, stockHistory = [], indexHistory = [], params = {} } = {}) {
    return buildBlueChipModeAnalysis({ stockCode, indexCode, stockHistory, indexHistory, params });
  },
};

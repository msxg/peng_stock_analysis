import dayjs from 'dayjs';
import { analysisRepository } from '../repositories/analysisRepository.js';
import { stockDataService } from './stockDataService.js';

function findCloseByDate(rows, targetDate) {
  const target = dayjs(targetDate);
  const row = rows.find((item) => dayjs(item.date).isSame(target, 'day'));
  return row?.close ?? null;
}

function findCloseOnOrAfter(rows, targetDate) {
  const target = dayjs(targetDate);
  const row = rows.find((item) => dayjs(item.date).isSame(target, 'day') || dayjs(item.date).isAfter(target, 'day'));
  return row?.close ?? null;
}

function inferDirectionHit(recommendation, returnPct) {
  if (!recommendation) return returnPct >= 0;
  if (recommendation.includes('减仓') || recommendation.includes('观望')) return returnPct <= 0;
  return returnPct >= 0;
}

function isBearishRecommendation(recommendation) {
  const text = String(recommendation || '');
  return text.includes('减仓') || text.includes('观望') || text.includes('防守');
}

function findWindowRows(rows, startDate, endDate) {
  const start = dayjs(startDate);
  const end = dayjs(endDate);
  return rows.filter((item) => {
    const date = dayjs(item.date);
    return (date.isSame(start, 'day') || date.isAfter(start, 'day'))
      && (date.isSame(end, 'day') || date.isBefore(end, 'day'));
  });
}

function calcTpSlHit({ recommendation, startPrice, targetPrice, stopLoss, windowRows }) {
  if (!windowRows.length) {
    return { tpHit: false, slHit: false };
  }

  const highest = Math.max(...windowRows.map((item) => Number(item.high || item.close || 0)));
  const lowest = Math.min(...windowRows.map((item) => Number(item.low || item.close || 0)));
  const bearish = isBearishRecommendation(recommendation);

  if (bearish) {
    const shortTp = Number.isFinite(targetPrice) ? targetPrice : Number((startPrice * 0.95).toFixed(2));
    const shortSl = Number.isFinite(stopLoss) ? stopLoss : Number((startPrice * 1.05).toFixed(2));
    return {
      tpHit: lowest <= shortTp,
      slHit: highest >= shortSl,
    };
  }

  const longTp = Number.isFinite(targetPrice) ? targetPrice : Number((startPrice * 1.1).toFixed(2));
  const longSl = Number.isFinite(stopLoss) ? stopLoss : Number((startPrice * 0.95).toFixed(2));
  return {
    tpHit: highest >= longTp,
    slHit: lowest <= longSl,
  };
}

export const backtestService = {
  async runBacktest({ stockCode, evaluationDays = 5, force = false }) {
    const histories = analysisRepository.listHistoryRawForBacktest(stockCode, 1000);

    if (force) {
      analysisRepository.clearBacktestResults(evaluationDays, stockCode || null);
    }

    let inserted = 0;
    const byCode = new Map();

    for (const item of histories) {
      if (!byCode.has(item.stockCode)) {
        const payload = await stockDataService.getHistory(item.stockCode, { days: 730 });
        byCode.set(item.stockCode, payload.history);
      }

      const rows = byCode.get(item.stockCode) || [];
      const startPrice = findCloseByDate(rows, item.analysisDate) ?? findCloseOnOrAfter(rows, item.analysisDate);
      const windowEndDate = dayjs(item.analysisDate).add(evaluationDays, 'day').format('YYYY-MM-DD');
      const endPrice =
        findCloseOnOrAfter(rows, windowEndDate)
        ?? rows[rows.length - 1]?.close
        ?? null;

      if (!startPrice || !endPrice) continue;

      const returnPct = Number((((endPrice - startPrice) / startPrice) * 100).toFixed(2));
      const directionHit = inferDirectionHit(item.recommendation, returnPct);
      const windowRows = findWindowRows(rows, item.analysisDate, windowEndDate);
      const { tpHit, slHit } = calcTpSlHit({
        recommendation: item.recommendation,
        startPrice,
        targetPrice: Number(item.targetPrice),
        stopLoss: Number(item.stopLoss),
        windowRows,
      });

      analysisRepository.insertBacktestResult({
        analysisId: item.id,
        stockCode: item.stockCode,
        evaluationDays,
        startPrice,
        endPrice,
        returnPct,
        directionHit,
        tpHit,
        slHit,
      });
      inserted += 1;
    }

    return {
      inserted,
      evaluationDays,
      stockCode: stockCode || null,
      summary: analysisRepository.summarizeBacktest(evaluationDays),
    };
  },

  listResults(params) {
    return analysisRepository.listBacktestResults(params);
  },

  getOverallPerformance(evaluationDays = 5) {
    return analysisRepository.summarizeBacktest(evaluationDays);
  },

  getStockPerformance(evaluationDays = 5) {
    return analysisRepository.summarizeBacktestByStock(evaluationDays);
  },
};

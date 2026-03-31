import { randomUUID } from 'crypto';
import { calcBias, clamp } from '../utils/indicators.js';
import { formatDate } from '../utils/date.js';
import { systemRepository } from '../repositories/systemRepository.js';
import { stockDataService } from './stockDataService.js';
import { newsIntelService } from './newsIntelService.js';
import { fundamentalService } from './fundamentalService.js';
import { marketStrategyService } from './marketStrategyService.js';
import { marketReviewService } from './marketReviewService.js';

function parseNumericConfig(key, fallback) {
  const raw = systemRepository.getConfigValue(key);
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

function toRegion(market) {
  const text = String(market || '').toUpperCase();
  if (text.startsWith('US')) return 'us';
  return 'cn';
}

function scoreToLabel(score) {
  if (score >= 65) return '偏多';
  if (score <= 40) return '偏空';
  return '中性';
}

function buildChecklist({ trendBull, bias, volumeRatio, sentimentScore }) {
  return [
    {
      key: 'trend',
      label: '趋势结构（MA5 > MA10 > MA20）',
      status: trendBull ? '满足' : '注意',
      reason: trendBull ? '均线多头排列，趋势完整。' : '均线未形成多头排列。',
    },
    {
      key: 'bias',
      label: '乖离率风险控制',
      status: Math.abs(bias) <= 5 ? '满足' : '注意',
      reason: Math.abs(bias) <= 5 ? `当前乖离率 ${bias}%` : `当前乖离率 ${bias}%，存在追高风险。`,
    },
    {
      key: 'volume',
      label: '量能确认',
      status: volumeRatio >= 1 ? '满足' : '不满足',
      reason: volumeRatio >= 1 ? `量比 ${volumeRatio}，资金活跃。` : `量比 ${volumeRatio}，量能偏弱。`,
    },
    {
      key: 'sentiment',
      label: '舆情一致性',
      status: sentimentScore >= 0 ? '中性偏正' : '偏负',
      reason: `新闻情绪分 ${sentimentScore}，需结合盘面验证。`,
    },
    {
      key: 'risk',
      label: '止损纪律',
      status: '满足',
      reason: '严格执行止损线，跌破即离场。',
    },
  ];
}

function buildRecommendation({ trendBull, bias, changePct, volumeRatio, sentimentScore }) {
  let score = 50;
  if (trendBull) score += 20;
  if (bias > 5) score -= 15;
  if (bias < -3) score += 8;
  if (changePct > 3) score -= 8;
  if (volumeRatio >= 1.2) score += 12;
  if (volumeRatio < 0.8) score -= 8;
  score += Math.round(sentimentScore * 10);

  const confidence = clamp(score, 10, 95);

  if (confidence >= 70) {
    return { action: '偏多持有/分批低吸', confidence };
  }
  if (confidence >= 50) {
    return { action: '中性观察，等待确认', confidence };
  }
  return { action: '谨慎减仓或观望', confidence };
}

function buildVolumeProfile(history, bins = 8) {
  if (!history.length) return [];
  const prices = history.map((item) => Number(item.close || 0)).filter((value) => value > 0);
  if (!prices.length) return [];

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (max <= min) {
    return [{ priceRange: `${min.toFixed(2)} - ${max.toFixed(2)}`, volume: 0, ratio: 100 }];
  }

  const width = (max - min) / bins;
  const buckets = Array.from({ length: bins }, (_, idx) => ({
    low: min + width * idx,
    high: idx === bins - 1 ? max : min + width * (idx + 1),
    volume: 0,
  }));

  history.forEach((item) => {
    const close = Number(item.close || 0);
    const volume = Number(item.volume || 0);
    if (!close || close < min || close > max) return;

    const idx = Math.min(bins - 1, Math.floor((close - min) / width));
    buckets[idx].volume += volume;
  });

  const total = buckets.reduce((sum, item) => sum + item.volume, 0) || 1;
  return buckets.map((item) => ({
    priceRange: `${item.low.toFixed(2)} - ${item.high.toFixed(2)}`,
    volume: item.volume,
    ratio: Number(((item.volume / total) * 100).toFixed(2)),
  }));
}

function buildReportMarkdown({
  queryId,
  quote,
  recommendation,
  bias,
  trendBull,
  checklist,
  prices,
  strategy,
  marketReview,
  sentimentScore,
}) {
  const headerDate = formatDate(new Date(), 'YYYY-MM-DD HH:mm');
  const checklistMd = checklist
    .map((item) => `- **${item.label}**：${item.status}｜${item.reason}`)
    .join('\n');
  const strategyPlan = (strategy?.plan || []).map((line) => `- ${line}`).join('\n');

  return `# ${quote.stockCode} ${quote.stockName} 决策仪表盘\n\n`
    + `- 分析时间：${headerDate}\n`
    + `- Query ID：${queryId}\n`
    + `- 市场：${quote.market}\n\n`
    + `## 核心结论\n\n`
    + `**${recommendation.action}**（置信度 ${recommendation.confidence}%）\n\n`
    + `## 关键指标\n\n`
    + `- 最新价：${quote.price}\n`
    + `- 当日涨跌：${quote.changePct}%\n`
    + `- MA5 / MA10 / MA20：${quote.ma5 || '-'} / ${quote.ma10 || '-'} / ${quote.ma20 || '-'}\n`
    + `- 乖离率（相对 MA10）：${bias}%\n`
    + `- 量比：${quote.volumeRatio}\n`
    + `- 舆情分：${sentimentScore}\n`
    + `- 趋势状态：${trendBull ? '多头排列' : '震荡/待确认'}\n\n`
    + `## 狙击点位\n\n`
    + `- 参考买入：${prices.buyPrice}\n`
    + `- 止损位：${prices.stopLoss}\n`
    + `- 目标位：${prices.targetPrice}\n\n`
    + `## 市场策略\n\n`
    + `- 策略系统：${strategy?.system || '-'}\n`
    + `- 当前模式：${strategy?.mode || '-'}\n`
    + `${strategyPlan || '- 暂无策略计划'}\n\n`
    + `## 大盘复盘摘要\n\n`
    + `- 市场情绪：${marketReview?.overview?.sentiment || 'neutral'}\n`
    + `- 情绪评分：${marketReview?.overview?.score ?? 50}\n`
    + `- 概览：${marketReview?.overview?.text || '暂无'}\n\n`
    + `## 操作检查清单\n\n${checklistMd}\n\n`
    + `## 风险提示\n\n`
    + `仅供学习研究，不构成投资建议。请结合自身风险承受能力独立决策。\n`;
}

export const analysisEngineService = {
  async analyzeStock(stockCode) {
    const queryId = randomUUID();
    const biasThreshold = parseNumericConfig('BIAS_THRESHOLD', 5);
    const { quote, history } = await stockDataService.getHistory(stockCode, { days: 220 });

    const trendBull = Boolean(quote.ma5 && quote.ma10 && quote.ma20 && quote.ma5 > quote.ma10 && quote.ma10 > quote.ma20);
    const bias = calcBias(quote.price, quote.ma10 || quote.price);

    let newsPayload = { items: [], sentimentScore: 0, source: 'fallback' };
    try {
      newsPayload = await newsIntelService.getStockNews({
        stockCode: quote.stockCode,
        stockName: quote.stockName,
      });
    } catch {
      newsPayload = {
        items: [],
        sentimentScore: 0,
        source: 'degraded',
      };
    }

    const recommendation = buildRecommendation({
      trendBull,
      bias,
      changePct: quote.changePct,
      volumeRatio: quote.volumeRatio,
      sentimentScore: newsPayload.sentimentScore || 0,
    });

    const correction = bias > biasThreshold ? 0.985 : 0.995;
    const buyPrice = Number((quote.price * correction).toFixed(2));
    const stopLoss = Number((buyPrice * 0.95).toFixed(2));
    const targetPrice = Number((buyPrice * 1.1).toFixed(2));

    const checklist = buildChecklist({
      trendBull,
      bias,
      volumeRatio: quote.volumeRatio,
      sentimentScore: newsPayload.sentimentScore || 0,
    });

    const latestCandles = history.slice(-60);
    const volumeProfile = buildVolumeProfile(history.slice(-120), 10);
    const region = toRegion(quote.market);

    let marketReview = { region, overview: { sentiment: 'neutral', score: 50, text: '暂无市场复盘数据' } };
    try {
      const reviewPayload = await marketReviewService.getMarketReview(region);
      marketReview = region === 'us' ? reviewPayload.us : reviewPayload.cn;
    } catch {
      // fail-open
    }

    let fundamentalContext = { fail_open: true, degraded: true };
    try {
      fundamentalContext = await fundamentalService.buildFundamentalContext({
        stockCode: quote.stockCode,
        quote,
        history,
      });
    } catch {
      // fail-open
    }

    const marketSentiment = clamp(
      Number(((marketReview?.overview?.score ?? 50) * 0.6 + (newsPayload.sentimentScore || 0) * 20 + 20).toFixed(0)),
      5,
      95,
    );

    const strategy = marketStrategyService.buildStrategy({
      market: quote.market,
      marketSentiment,
      trendBull,
    });

    const summary = `${recommendation.action}，趋势${trendBull ? '偏强' : '中性'}，乖离率 ${bias}%`;
    const reportMarkdown = buildReportMarkdown({
      queryId,
      quote,
      recommendation,
      bias,
      trendBull,
      checklist,
      prices: { buyPrice, stopLoss, targetPrice },
      strategy,
      marketReview,
      sentimentScore: newsPayload.sentimentScore || 0,
    });

    const sentiment = {
      score: marketSentiment,
      label: scoreToLabel(marketSentiment),
      newsScore: newsPayload.sentimentScore || 0,
      market: marketReview?.overview?.sentiment || 'neutral',
    };

    return {
      queryId,
      stockCode: quote.stockCode,
      stockName: quote.stockName,
      market: quote.market,
      analysisDate: formatDate(new Date(), 'YYYY-MM-DD'),
      summary,
      recommendation: recommendation.action,
      buyPrice,
      stopLoss,
      targetPrice,
      confidence: recommendation.confidence,
      technical: {
        quote,
        trendBull,
        bias,
        latestCandles,
        volumeProfile,
        checklist,
        maAlignment: trendBull ? 'bullish' : 'neutral',
        extended: {
          sentiment,
          fundamental_context: fundamentalContext,
          strategy,
          market_review: marketReview,
          dashboard: {
            oneLiner: recommendation.action,
            buyPrice,
            stopLoss,
            targetPrice,
            checklist,
          },
          newsMeta: {
            source: newsPayload.source,
            sentimentScore: newsPayload.sentimentScore || 0,
          },
          disclaimer: '仅供参考，不构成投资建议。',
        },
      },
      sentiment,
      news: newsPayload.items || [],
      newsMeta: {
        source: newsPayload.source,
        sentimentScore: newsPayload.sentimentScore || 0,
      },
      fundamental_context: fundamentalContext,
      strategy,
      market_review: marketReview,
      dashboard: {
        oneLiner: recommendation.action,
        buyPrice,
        stopLoss,
        targetPrice,
        checklist,
      },
      reportMarkdown,
      disclaimer: '仅供参考，不构成投资建议。',
    };
  },
};

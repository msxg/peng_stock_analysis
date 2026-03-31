import { stockDataService } from './stockDataService.js';

const REGION_INDEX = {
  cn: [
    { code: '510300', name: '沪深300ETF' },
    { code: '159915', name: '创业板ETF' },
  ],
  us: [
    { code: 'SPX', name: 'S&P 500' },
    { code: 'DJI', name: 'Dow Jones' },
    { code: 'IXIC', name: 'NASDAQ' },
  ],
};

function buildSectorSnapshot(region) {
  if (region === 'us') {
    return {
      top: [
        { name: 'Semiconductors', changePct: 1.82 },
        { name: 'Cloud Software', changePct: 1.26 },
        { name: 'Cybersecurity', changePct: 0.94 },
      ],
      bottom: [
        { name: 'Utilities', changePct: -0.88 },
        { name: 'Consumer Staples', changePct: -0.63 },
        { name: 'REITs', changePct: -0.47 },
      ],
    };
  }

  return {
    top: [
      { name: 'AI算力', changePct: 2.13 },
      { name: '创新药', changePct: 1.46 },
      { name: '军工', changePct: 1.12 },
    ],
    bottom: [
      { name: '地产链', changePct: -1.41 },
      { name: '光伏', changePct: -1.18 },
      { name: '煤炭', changePct: -0.74 },
    ],
  };
}

function summarizeMarket(indices) {
  if (!indices.length) {
    return {
      sentiment: 'neutral',
      score: 50,
      text: '暂无市场数据，建议保持谨慎。',
    };
  }

  const avg = indices.reduce((sum, item) => sum + (item.changePct || 0), 0) / indices.length;
  const score = Math.max(5, Math.min(95, Number((50 + avg * 10).toFixed(0))));
  const sentiment = avg > 0.8 ? 'risk-on' : avg < -0.8 ? 'risk-off' : 'neutral';
  const text = avg > 0
    ? '指数整体偏强，短线风险偏好有所回升。'
    : avg < 0
      ? '指数整体承压，建议控制仓位与回撤。'
      : '指数窄幅震荡，短线以结构性机会为主。';

  return { sentiment, score, text };
}

async function loadRegion(region) {
  const benchmark = REGION_INDEX[region] || [];
  const indices = [];

  for (const item of benchmark) {
    try {
      const quote = await stockDataService.getQuote(item.code);
      indices.push({
        code: item.code,
        name: item.name,
        price: quote.price,
        changePct: quote.changePct,
        dataSource: quote.dataSource,
      });
    } catch {
      indices.push({
        code: item.code,
        name: item.name,
        price: null,
        changePct: null,
        dataSource: 'unavailable',
      });
    }
  }

  return {
    region,
    indices,
    sectors: buildSectorSnapshot(region),
    overview: summarizeMarket(indices.filter((item) => typeof item.changePct === 'number')),
  };
}

export const marketReviewService = {
  async getMarketReview(region = 'both') {
    if (region === 'cn') {
      return {
        generatedAt: new Date().toISOString(),
        region,
        cn: await loadRegion('cn'),
      };
    }
    if (region === 'us') {
      return {
        generatedAt: new Date().toISOString(),
        region,
        us: await loadRegion('us'),
      };
    }

    const [cn, us] = await Promise.all([loadRegion('cn'), loadRegion('us')]);
    return {
      generatedAt: new Date().toISOString(),
      region: 'both',
      cn,
      us,
    };
  },
};

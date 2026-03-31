import { normalizeStockCode } from '../utils/stockCode.js';

const POSITIVE_WORDS = ['增长', '创新高', '利好', '上调', '回购', '盈利', '增持', '突破', '扩张', 'improve', 'beat', 'upgrade', 'growth'];
const NEGATIVE_WORDS = ['下滑', '风险', '减持', '诉讼', '亏损', '处罚', '波动', '降级', '失速', 'miss', 'downgrade', 'weak'];

function calcHeadlineSentiment(text) {
  const content = String(text || '').toLowerCase();
  let score = 0;
  POSITIVE_WORDS.forEach((word) => {
    if (content.includes(word.toLowerCase())) score += 1;
  });
  NEGATIVE_WORDS.forEach((word) => {
    if (content.includes(word.toLowerCase())) score -= 1;
  });
  return Math.max(-1, Math.min(1, score / 3));
}

function aggregateSentiment(items) {
  if (!items.length) return 0;
  const avg = items.reduce((sum, item) => sum + (item.sentimentScore || 0), 0) / items.length;
  return Number(avg.toFixed(2));
}

function buildFallbackNews(stockCode) {
  const code = normalizeStockCode(stockCode);
  const now = new Date().toISOString();
  return [
    {
      title: `${code} 近期波动加剧，关注均线与量能配合`,
      url: '#',
      source: 'local_fallback',
      publishedAt: now,
      sentimentScore: 0,
      snippet: '当前为兜底新闻摘要，建议结合实时资讯源进一步确认。',
    },
  ];
}

async function fetchYahooNews(keyword) {
  const url = new URL('https://query1.finance.yahoo.com/v1/finance/search');
  url.searchParams.set('q', keyword);
  url.searchParams.set('quotesCount', '6');
  url.searchParams.set('newsCount', '8');
  url.searchParams.set('lang', 'zh-CN');
  url.searchParams.set('region', 'CN');

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (peng-stock-analysis)',
    },
  });

  if (!response.ok) {
    throw new Error(`Yahoo news HTTP ${response.status}`);
  }

  const json = await response.json();
  const newsItems = Array.isArray(json.news) ? json.news : [];

  return newsItems.map((item) => {
    const title = item.title || '';
    return {
      title,
      url: item.link || '#',
      source: item.publisher || 'Yahoo',
      publishedAt: item.providerPublishTime
        ? new Date(item.providerPublishTime * 1000).toISOString()
        : new Date().toISOString(),
      sentimentScore: calcHeadlineSentiment(title),
      snippet: item.summary || '',
    };
  });
}

export const newsIntelService = {
  async getStockNews({ stockCode, stockName }) {
    const code = normalizeStockCode(stockCode);

    try {
      const byCode = await fetchYahooNews(code);
      const byName = stockName ? await fetchYahooNews(stockName) : [];
      const mergedMap = new Map();
      [...byCode, ...byName].forEach((item) => {
        if (!mergedMap.has(item.title)) {
          mergedMap.set(item.title, item);
        }
      });
      const merged = Array.from(mergedMap.values()).slice(0, 8);
      return {
        items: merged,
        sentimentScore: aggregateSentiment(merged),
        source: 'yahoo_search',
      };
    } catch {
      const fallback = buildFallbackNews(code);
      return {
        items: fallback,
        sentimentScore: 0,
        source: 'fallback',
      };
    }
  },
};

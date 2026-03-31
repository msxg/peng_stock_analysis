import { normalizeStockCode } from '../utils/stockCode.js';

const LOCAL_STOCK_DICTIONARY = [
  { code: '600519', name: '贵州茅台', pinyin: 'GZMT', aliases: ['茅台', 'maotai'] },
  { code: '000001', name: '平安银行', pinyin: 'PAYH', aliases: ['平安', 'pingan'] },
  { code: '601857', name: '中国石油', pinyin: 'ZGSY', aliases: ['中石油', 'petrochina'] },
  { code: '00700', name: '腾讯控股', pinyin: 'TXKG', aliases: ['腾讯', 'tencent'] },
  { code: '09988', name: '阿里巴巴', pinyin: 'ALBB', aliases: ['阿里', 'alibaba'] },
  { code: 'AAPL', name: 'Apple', pinyin: 'APPLE', aliases: ['苹果', 'apple'] },
  { code: 'TSLA', name: 'Tesla', pinyin: 'TESLA', aliases: ['特斯拉', 'tesla'] },
  { code: 'NVDA', name: 'NVIDIA', pinyin: 'NVIDIA', aliases: ['英伟达', 'nvidia'] },
];

function confidenceLevel(score) {
  if (score >= 0.85) return 'high';
  if (score >= 0.65) return 'medium';
  return 'low';
}

function resolveByLocal(input) {
  const keyword = String(input || '').trim().toLowerCase();
  if (!keyword) return null;

  for (const item of LOCAL_STOCK_DICTIONARY) {
    if (item.name.toLowerCase() === keyword || item.code.toLowerCase() === keyword) {
      return {
        code: item.code,
        name: item.name,
        confidence: 0.95,
        confidenceLevel: confidenceLevel(0.95),
        source: 'local_exact',
      };
    }

    const aliasHit = (item.aliases || []).some((alias) => alias.toLowerCase() === keyword);
    if (aliasHit) {
      return {
        code: item.code,
        name: item.name,
        confidence: 0.9,
        confidenceLevel: confidenceLevel(0.9),
        source: 'local_alias',
      };
    }

    if (item.pinyin.toLowerCase() === keyword.replace(/\s+/g, '')) {
      return {
        code: item.code,
        name: item.name,
        confidence: 0.86,
        confidenceLevel: confidenceLevel(0.86),
        source: 'local_pinyin',
      };
    }
  }

  return null;
}

async function resolveByEastMoney(input) {
  const keyword = String(input || '').trim();
  if (!keyword) return null;

  const url = new URL('https://searchapi.eastmoney.com/api/suggest/get');
  url.searchParams.set('input', keyword);
  url.searchParams.set('type', '14');
  url.searchParams.set('token', 'D43BF722C8E33BDC906FB84D85E326E8');

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (peng-stock-analysis)',
    },
  });

  if (!response.ok) {
    throw new Error(`EastMoney HTTP ${response.status}`);
  }

  const json = await response.json();
  const first = json?.QuotationCodeTable?.Data?.[0];
  if (!first?.Code) return null;

  return {
    code: normalizeStockCode(first.Code),
    name: first.Name || first.Code,
    confidence: 0.78,
    confidenceLevel: confidenceLevel(0.78),
    source: 'eastmoney_suggest',
    meta: {
      pinyin: first.PinYin || null,
      securityType: first.SecurityTypeName || null,
    },
  };
}

export const nameResolverService = {
  confidenceLevel,

  async resolveNameToCode(input) {
    const local = resolveByLocal(input);
    if (local) return local;

    try {
      const remote = await resolveByEastMoney(input);
      if (remote) return remote;
    } catch {
      return null;
    }

    return null;
  },
};

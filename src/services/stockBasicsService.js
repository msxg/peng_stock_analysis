import xlsx from 'xlsx';
import { HttpError } from '../utils/httpError.js';
import { normalizeStockCode } from '../utils/stockCode.js';
import { stockBasicsRepository } from '../repositories/stockBasicsRepository.js';
import { stockDataService } from './stockDataService.js';
import { getOfficialStockTradingHours } from '../utils/tradingHours.js';

const MARKET_SYNC_CONFIG = [
  {
    market: 'A',
    fs: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23',
    subMarketByF13: {
      0: 'SZ',
      1: 'SH',
    },
  },
  {
    market: 'HK',
    fs: 'm:128+t:3,m:128+t:4,m:128+t:1,m:128+t:2',
    subMarketByF13: {
      128: 'HK',
    },
  },
  {
    market: 'US',
    fs: 'm:105,m:106,m:107',
    subMarketByF13: {
      105: 'NASDAQ',
      106: 'NYSE',
      107: 'AMEX',
    },
  },
];

let initialSyncPromise = null;
const FUNDAMENTALS_REFRESH_MS = 12 * 60 * 60 * 1000;

function toNumberOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function positiveNumberOrNull(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

function inferAStockSubMarketByCode(code = '') {
  const normalized = String(code || '').trim();
  if (normalized.startsWith('6') || normalized.startsWith('9')) return 'SH';
  if (normalized.startsWith('8') || normalized.startsWith('4')) return 'BJ';
  return 'SZ';
}

function formatListingDateCompact(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, '');
  if (digits.length >= 8) return digits.slice(0, 8);
  return null;
}

function parseTencentTimestamp(value) {
  const text = String(value || '').trim();
  if (!/^\d{14}$/.test(text)) return null;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  const hour = Number(text.slice(8, 10));
  const minute = Number(text.slice(10, 12));
  const second = Number(text.slice(12, 14));
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function decodeGbkPayload(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  try {
    return new TextDecoder('gbk').decode(source);
  } catch {
    return source.toString('utf8');
  }
}

function parseTencentQuotePayload(text = '') {
  const matched = String(text || '').trim().match(/="([^"]*)"/);
  if (!matched) {
    throw new HttpError(502, '腾讯行情数据格式异常');
  }
  const parts = String(matched[1] || '').split('~');
  if (parts.length < 74) {
    throw new HttpError(502, '腾讯行情数据字段不足');
  }

  const name = String(parts[1] || '').trim();
  const code = String(parts[2] || '').trim().toUpperCase();
  const latestPrice = toNumberOrNull(parts[3]);
  const floatShares = toNumberOrNull(parts[72]) || toNumberOrNull(parts[76]);
  const totalShares = toNumberOrNull(parts[73]);
  const floatCapYi = toNumberOrNull(parts[44]);
  const totalCapYi = toNumberOrNull(parts[45]);
  const computedFloatCap = (
    Number.isFinite(floatShares) && Number.isFinite(latestPrice)
      ? floatShares * latestPrice
      : null
  );
  const computedTotalCap = (
    Number.isFinite(totalShares) && Number.isFinite(latestPrice)
      ? totalShares * latestPrice
      : null
  );

  return {
    code,
    name: name || null,
    latestPrice: positiveNumberOrNull(latestPrice),
    floatShares: positiveNumberOrNull(floatShares),
    totalShares: positiveNumberOrNull(totalShares),
    floatMarketCap: positiveNumberOrNull(Number.isFinite(floatCapYi) ? floatCapYi * 100000000 : computedFloatCap),
    totalMarketCap: positiveNumberOrNull(Number.isFinite(totalCapYi) ? totalCapYi * 100000000 : computedTotalCap),
    quoteAt: parseTencentTimestamp(parts[30]),
  };
}

function shouldRefreshFundamentals(local) {
  if (!local) return true;
  const missingCore = (
    !Number.isFinite(Number(local.totalShares))
    || !Number.isFinite(Number(local.floatShares))
    || !local.mainBusiness
    || !local.businessScope
    || !local.listingDate
  );
  if (missingCore) return true;
  if (!local.fundamentalsSyncedAt) return true;
  const syncedAtMs = new Date(local.fundamentalsSyncedAt).getTime();
  if (!Number.isFinite(syncedAtMs)) return true;
  return (Date.now() - syncedAtMs) > FUNDAMENTALS_REFRESH_MS;
}

function normalizeBasicCodeByMarket(code, market) {
  const normalized = normalizeStockCode(code);
  if (market === 'HK' && /^\d{1,5}$/.test(normalized)) {
    return normalized.padStart(5, '0');
  }
  return normalized;
}

function parseSinaCount(text) {
  const raw = String(text || '').trim().replaceAll('"', '');
  const num = Number(raw);
  return Number.isFinite(num) ? Math.max(num, 0) : 0;
}

function inferAStockSubMarket(item) {
  const symbol = String(item?.symbol || '').toLowerCase();
  if (symbol.startsWith('sh')) return 'SH';
  if (symbol.startsWith('sz')) return 'SZ';
  if (symbol.startsWith('bj')) return 'BJ';
  const code = String(item?.code || '').trim();
  if (code.startsWith('6') || code.startsWith('9')) return 'SH';
  if (code.startsWith('8') || code.startsWith('4')) return 'BJ';
  return 'SZ';
}

function parsePipeTable(text = '') {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const header = lines[0].split('|').map((item) => item.trim());
  const result = [];
  for (let idx = 1; idx < lines.length; idx += 1) {
    const line = lines[idx];
    if (/^file creation time/i.test(line)) break;
    const cols = line.split('|');
    if (!cols.length || cols.length < 2) continue;
    const row = {};
    header.forEach((key, i) => {
      row[key] = (cols[i] || '').trim();
    });
    result.push(row);
  }
  return result;
}

function inferHkexMaxRow(worksheet) {
  let maxRow = 8;
  Object.keys(worksheet || {}).forEach((key) => {
    if (key.startsWith('!')) return;
    const row = Number(String(key).replace(/^[A-Z]+/, ''));
    if (Number.isFinite(row) && row > maxRow) {
      maxRow = row;
    }
  });
  return maxRow;
}

function splitToChunks(items = [], chunkSize = 200) {
  const source = Array.isArray(items) ? items : [];
  const size = Math.max(1, Number(chunkSize) || 1);
  const result = [];
  for (let index = 0; index < source.length; index += size) {
    result.push(source.slice(index, index + size));
  }
  return result;
}

async function requestTencentAStockFundamentals(code, subMarket = '') {
  const market = String(subMarket || '').trim().toUpperCase() || inferAStockSubMarketByCode(code);
  const prefix = market === 'SH' ? 'sh' : 'sz';
  const normalizedCode = normalizeStockCode(code);
  const symbol = `${prefix}${normalizedCode}`;
  const response = await fetch(`https://qt.gtimg.cn/q=${encodeURIComponent(symbol)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (peng-stock-analysis stock-basics tencent-a)',
      Referer: 'https://gu.qq.com/',
    },
  });
  if (!response.ok) {
    throw new HttpError(response.status, `腾讯A股行情请求失败: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const text = decodeGbkPayload(buffer);
  const parsed = parseTencentQuotePayload(text);
  return {
    ...parsed,
    source: 'tencent.qt',
  };
}

async function requestEastmoneyAStockProfile(code, subMarket = '') {
  const normalizedCode = normalizeStockCode(code);
  const market = String(subMarket || '').trim().toUpperCase() || inferAStockSubMarketByCode(normalizedCode);
  const suffix = market === 'SH' ? 'SH' : 'SZ';
  const secuCode = `${normalizedCode}.${suffix}`;

  const url = new URL('https://datacenter-web.eastmoney.com/api/data/v1/get');
  url.searchParams.set('reportName', 'RPT_HSF9_BASIC_ORGINFO');
  url.searchParams.set(
    'columns',
    'SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,INDUSTRYCSRC1,REG_CAPITALY,LISTING_DATE,MAIN_BUSINESS,BUSINESS_SCOPE,ORG_PROFILE',
  );
  url.searchParams.set('filter', `(SECUCODE="${secuCode}")`);
  url.searchParams.set('pageNumber', '1');
  url.searchParams.set('pageSize', '1');
  url.searchParams.set('source', 'WEB');
  url.searchParams.set('client', 'WEB');

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (peng-stock-analysis stock-basics eastmoney-org)',
      Referer: 'https://emweb.securities.eastmoney.com/',
    },
  });
  if (!response.ok) {
    throw new HttpError(response.status, `东方财富公司资料请求失败: ${response.status}`);
  }

  const payload = await response.json();
  const row = payload?.result?.data?.[0];
  if (!row) {
    throw new HttpError(404, `未查询到公司资料: ${secuCode}`);
  }

  return {
    name: String(row.SECURITY_NAME_ABBR || '').trim() || null,
    industry: String(row.INDUSTRYCSRC1 || '').trim() || null,
    totalShares: positiveNumberOrNull(row.REG_CAPITALY),
    listingDate: formatListingDateCompact(row.LISTING_DATE),
    mainBusiness: String(row.MAIN_BUSINESS || '').trim() || null,
    businessScope: String(row.BUSINESS_SCOPE || '').trim() || null,
    companyProfile: String(row.ORG_PROFILE || '').trim() || null,
    source: 'eastmoney.datacenter.orginfo',
  };
}

async function syncAStockFundamentals(local, code) {
  const subMarket = String(local?.subMarket || '').trim().toUpperCase();
  const providers = [];
  let realtime = null;
  let profile = null;

  try {
    realtime = await requestTencentAStockFundamentals(code, subMarket);
    providers.push(realtime.source);
  } catch {
    // fail-open
  }

  try {
    profile = await requestEastmoneyAStockProfile(code, subMarket);
    providers.push(profile.source);
  } catch {
    // fail-open
  }

  if (!realtime && !profile) {
    return null;
  }

  const latestPrice = realtime?.latestPrice ?? positiveNumberOrNull(local?.latestPrice);
  const floatShares = realtime?.floatShares ?? positiveNumberOrNull(local?.floatShares);
  const totalShares = realtime?.totalShares
    ?? profile?.totalShares
    ?? positiveNumberOrNull(local?.totalShares);
  const totalMarketCap = realtime?.totalMarketCap
    ?? (Number.isFinite(totalShares) && Number.isFinite(latestPrice) ? totalShares * latestPrice : null)
    ?? positiveNumberOrNull(local?.totalMarketCap);
  const floatMarketCap = realtime?.floatMarketCap
    ?? (Number.isFinite(floatShares) && Number.isFinite(latestPrice) ? floatShares * latestPrice : null)
    ?? positiveNumberOrNull(local?.floatMarketCap);

  const syncedAt = new Date().toISOString();
  const merged = {
    market: local?.market || 'A',
    subMarket: local?.subMarket || inferAStockSubMarketByCode(code),
    code,
    name: profile?.name || realtime?.name || local?.name || code,
    sector: local?.sector || profile?.industry || null,
    industry: profile?.industry || local?.industry || null,
    latestPrice,
    totalShares,
    floatShares,
    totalMarketCap,
    floatMarketCap,
    listingDate: profile?.listingDate || local?.listingDate || null,
    mainBusiness: profile?.mainBusiness || local?.mainBusiness || null,
    businessScope: profile?.businessScope || local?.businessScope || null,
    companyProfile: profile?.companyProfile || local?.companyProfile || null,
    fundamentalsSource: providers.join(' | ') || local?.fundamentalsSource || null,
    fundamentalsSyncedAt: syncedAt,
    source: local?.source || 'local.fundamentals',
    syncedAt: local?.syncedAt || syncedAt,
  };

  stockBasicsRepository.upsertFundamentals(merged);
  return merged;
}

function resolveASymbolByCode(code, subMarket = '') {
  const normalizedCode = normalizeStockCode(code);
  const market = String(subMarket || '').trim().toUpperCase() || inferAStockSubMarketByCode(normalizedCode);
  const prefix = market === 'SH' ? 'sh' : 'sz';
  return `${prefix}${normalizedCode}`;
}

function parseTencentQuoteLine(line = '') {
  const matched = String(line || '').trim().match(/^v_([a-z]{2}\d{6})="([^"]*)";?$/i);
  if (!matched) return null;
  const [, symbol, payload] = matched;
  const parts = String(payload || '').split('~');
  if (parts.length < 74) return null;

  const code = String(parts[2] || '').trim().toUpperCase();
  if (!/^\d{6}$/.test(code)) return null;
  const latestPrice = positiveNumberOrNull(parts[3]);
  const floatShares = positiveNumberOrNull(parts[72]) || positiveNumberOrNull(parts[76]);
  const totalShares = positiveNumberOrNull(parts[73]);
  const floatCapYi = toNumberOrNull(parts[44]);
  const totalCapYi = toNumberOrNull(parts[45]);
  const computedFloatCap = Number.isFinite(floatShares) && Number.isFinite(latestPrice) ? floatShares * latestPrice : null;
  const computedTotalCap = Number.isFinite(totalShares) && Number.isFinite(latestPrice) ? totalShares * latestPrice : null;

  return {
    symbol: symbol.toLowerCase(),
    code,
    name: String(parts[1] || '').trim() || null,
    latestPrice,
    floatShares,
    totalShares,
    floatMarketCap: positiveNumberOrNull(Number.isFinite(floatCapYi) ? floatCapYi * 100000000 : computedFloatCap),
    totalMarketCap: positiveNumberOrNull(Number.isFinite(totalCapYi) ? totalCapYi * 100000000 : computedTotalCap),
    quoteAt: parseTencentTimestamp(parts[30]),
  };
}

async function syncATencentQuotesBulk(rows = [], syncedAt = new Date().toISOString()) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  if (!sourceRows.length) {
    return { source: 'tencent.qt.batch', updated: 0 };
  }

  const symbols = sourceRows.map((row) => resolveASymbolByCode(row.code, row.subMarket));
  const symbolChunks = splitToChunks(Array.from(new Set(symbols)), 180);
  const parsedMap = new Map();

  for (const chunk of symbolChunks) {
    const url = `https://qt.gtimg.cn/q=${chunk.join(',')}`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (peng-stock-analysis stock-basics tencent-batch)',
        Referer: 'https://gu.qq.com/',
      },
    });
    if (!resp.ok) {
      throw new HttpError(resp.status, `腾讯批量行情请求失败: ${resp.status}`);
    }
    const text = decodeGbkPayload(Buffer.from(await resp.arrayBuffer()));
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    lines.forEach((line) => {
      const parsed = parseTencentQuoteLine(line);
      if (!parsed) return;
      parsedMap.set(parsed.code, parsed);
    });
  }

  const upserts = sourceRows.map((row) => {
    const parsed = parsedMap.get(row.code);
    if (!parsed) return null;
    return {
      market: 'A',
      subMarket: row.subMarket || inferAStockSubMarketByCode(row.code),
      code: row.code,
      name: parsed.name || row.name || row.code,
      sector: row.sector || null,
      industry: row.industry || row.sector || null,
      latestPrice: parsed.latestPrice ?? positiveNumberOrNull(row.latestPrice),
      totalShares: parsed.totalShares ?? positiveNumberOrNull(row.totalShares),
      floatShares: parsed.floatShares ?? positiveNumberOrNull(row.floatShares),
      totalMarketCap: parsed.totalMarketCap ?? positiveNumberOrNull(row.totalMarketCap),
      floatMarketCap: parsed.floatMarketCap ?? positiveNumberOrNull(row.floatMarketCap),
      listingDate: row.listingDate || null,
      mainBusiness: row.mainBusiness || null,
      businessScope: row.businessScope || null,
      companyProfile: row.companyProfile || null,
      fundamentalsSource: row.fundamentalsSource
        ? `${row.fundamentalsSource} | tencent.qt.batch`
        : 'tencent.qt.batch',
      fundamentalsSyncedAt: syncedAt,
      source: row.source || 'local.sync',
      syncedAt: row.syncedAt || syncedAt,
    };
  }).filter(Boolean);

  stockBasicsRepository.upsertMany(upserts);
  return {
    source: 'tencent.qt.batch',
    updated: upserts.length,
  };
}

async function requestEastmoneyAOrgInfoPage(pageNumber = 1, pageSize = 500) {
  const url = new URL('https://datacenter-web.eastmoney.com/api/data/v1/get');
  url.searchParams.set('reportName', 'RPT_HSF9_BASIC_ORGINFO');
  url.searchParams.set(
    'columns',
    'SECURITY_CODE,SECURITY_NAME_ABBR,INDUSTRYCSRC1,LISTING_DATE,MAIN_BUSINESS,BUSINESS_SCOPE,ORG_PROFILE,REG_CAPITALY',
  );
  url.searchParams.set('pageNumber', String(pageNumber));
  url.searchParams.set('pageSize', String(pageSize));
  url.searchParams.set('sortColumns', 'SECURITY_CODE');
  url.searchParams.set('sortTypes', '1');
  url.searchParams.set('source', 'WEB');
  url.searchParams.set('client', 'WEB');

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (peng-stock-analysis stock-basics eastmoney-org-batch)',
      Referer: 'https://emweb.securities.eastmoney.com/',
    },
  });
  if (!response.ok) {
    throw new HttpError(response.status, `东方财富批量公司资料请求失败: ${response.status}`);
  }
  const payload = await response.json();
  const pages = Number(payload?.result?.pages || 0);
  const data = Array.isArray(payload?.result?.data) ? payload.result.data : [];
  return { pages, data };
}

async function syncAOrgInfoBulk(syncedAt = new Date().toISOString()) {
  const pageSize = 500;
  const maxPages = 80;
  let currentPage = 1;
  let totalPages = 1;
  let totalUpdated = 0;

  while (currentPage <= totalPages && currentPage <= maxPages) {
    const { pages, data } = await requestEastmoneyAOrgInfoPage(currentPage, pageSize);
    totalPages = pages > 0 ? pages : totalPages;
    if (!data.length) break;

    const upserts = data
      .map((row) => {
        const code = normalizeStockCode(row.SECURITY_CODE || '');
        if (!/^\d{6}$/.test(code)) return null;
        const industry = String(row.INDUSTRYCSRC1 || '').trim() || null;
        const listingDate = formatListingDateCompact(row.LISTING_DATE);
        const mainBusiness = String(row.MAIN_BUSINESS || '').trim() || null;
        const businessScope = String(row.BUSINESS_SCOPE || '').trim() || null;
        const companyProfile = String(row.ORG_PROFILE || '').trim() || null;
        const totalShares = positiveNumberOrNull(row.REG_CAPITALY);
        return {
          market: 'A',
          subMarket: inferAStockSubMarketByCode(code),
          code,
          name: String(row.SECURITY_NAME_ABBR || '').trim() || code,
          sector: industry,
          industry,
          totalShares,
          listingDate,
          mainBusiness,
          businessScope,
          companyProfile,
          fundamentalsSource: 'eastmoney.datacenter.orginfo.batch',
          fundamentalsSyncedAt: syncedAt,
          source: 'eastmoney.datacenter.orginfo.batch',
          syncedAt,
        };
      })
      .filter(Boolean);

    if (!upserts.length) break;
    stockBasicsRepository.upsertMany(upserts);
    totalUpdated += upserts.length;
    currentPage += 1;
  }

  return {
    source: 'eastmoney.datacenter.orginfo.batch',
    updated: totalUpdated,
    pagesFetched: Math.min(currentPage - 1, maxPages),
    maxPages,
  };
}

async function syncAFundamentalsBulk(syncedAt = new Date().toISOString()) {
  const result = {
    failOpen: true,
    steps: [],
  };

  try {
    const org = await syncAOrgInfoBulk(syncedAt);
    result.steps.push(org);
  } catch (error) {
    result.steps.push({
      source: 'eastmoney.datacenter.orginfo.batch',
      updated: 0,
      error: error.message,
    });
  }

  try {
    const rows = stockBasicsRepository.listByMarket('A');
    const tencent = await syncATencentQuotesBulk(rows, syncedAt);
    result.steps.push(tencent);
  } catch (error) {
    result.steps.push({
      source: 'tencent.qt.batch',
      updated: 0,
      error: error.message,
    });
  }

  result.quality = stockBasicsRepository.getMarketQualityStats('A');
  return result;
}

function buildFundamentalItems(code, local, quote) {
  const quotePrice = positiveNumberOrNull(quote?.price);
  const preferLocalLatest = String(quote?.dataSource || '').trim().toLowerCase() === 'synthetic';
  const localLatest = positiveNumberOrNull(local?.latestPrice);
  const latest = (
    preferLocalLatest
      ? (localLatest ?? quotePrice)
      : (quotePrice ?? localLatest)
  );

  const totalShares = positiveNumberOrNull(local?.totalShares);
  const floatShares = positiveNumberOrNull(local?.floatShares);
  const totalMarketCap = positiveNumberOrNull(local?.totalMarketCap) ?? (
    Number.isFinite(totalShares) && Number.isFinite(latest) ? totalShares * latest : null
  );
  const floatMarketCap = positiveNumberOrNull(local?.floatMarketCap) ?? (
    Number.isFinite(floatShares) && Number.isFinite(latest) ? floatShares * latest : null
  );

  return [
    { item: '最新', value: latest },
    { item: '股票代码', value: code || local?.code || null },
    { item: '股票简称', value: local?.name || quote?.stockName || null },
    { item: '交易时间', value: getOfficialStockTradingHours(local || {}) || null },
    { item: '总股本', value: totalShares },
    { item: '流通股', value: floatShares },
    { item: '总市值', value: totalMarketCap },
    { item: '流通市值', value: floatMarketCap },
    { item: '行业', value: local?.industry || local?.sector || null },
    { item: '上市时间', value: local?.listingDate || null },
    { item: '主营业务', value: local?.mainBusiness || null },
    { item: '营业范围', value: local?.businessScope || null },
  ];
}

function normalizeSuggestKeyword(input = '') {
  return String(input || '').trim().toUpperCase().replace(/\s+/g, '');
}

function inferSuggestMarket(item = {}) {
  const classify = String(item?.Classify || '').trim();
  const securityTypeName = String(item?.SecurityTypeName || '').trim();
  const marketType = String(item?.MarketType || '').trim();
  const exchange = String(item?.JYS || '').trim().toUpperCase();

  if (
    classify === 'AStock'
    || securityTypeName.includes('沪')
    || securityTypeName.includes('深')
    || securityTypeName.includes('北')
    || ['1', '2'].includes(marketType)
  ) {
    const subMarket = marketType === '1'
      ? 'SH'
      : marketType === '2'
        ? 'SZ'
        : securityTypeName.includes('沪')
          ? 'SH'
          : securityTypeName.includes('深')
            ? 'SZ'
            : securityTypeName.includes('北')
              ? 'BJ'
              : '';
    return { market: 'A', subMarket };
  }

  if (classify === 'HkStock' || securityTypeName.includes('港') || marketType === '3') {
    return { market: 'HK', subMarket: 'HK' };
  }

  if (
    classify === 'UsStock'
    || securityTypeName.includes('美股')
    || ['NASDAQ', 'NYSE', 'AMEX'].includes(exchange)
  ) {
    return { market: 'US', subMarket: exchange || '' };
  }

  return { market: '', subMarket: '' };
}

function mapEastmoneySuggestItem(item = {}) {
  const marketInfo = inferSuggestMarket(item);
  if (!marketInfo.market) return null;

  const rawCode = String(item?.Code || item?.UnifiedCode || '').trim();
  const rawName = String(item?.Name || '').trim();
  if (!rawCode || !rawName) return null;

  const classify = String(item?.Classify || '').trim();
  const securityTypeName = String(item?.SecurityTypeName || '').trim();
  const pinyin = String(item?.PinYin || '').trim().toUpperCase();
  const isIndex = classify.toLowerCase().includes('index') || securityTypeName.includes('指数');

  let code = normalizeStockCode(rawCode);
  if (marketInfo.market === 'HK' && /^\d{1,5}$/.test(code)) {
    code = code.padStart(5, '0');
  }
  if (marketInfo.market === 'A' && isIndex && /^\d{6}$/.test(code) && ['SH', 'SZ'].includes(marketInfo.subMarket)) {
    code = `${marketInfo.subMarket}${code}`;
  }

  return {
    code,
    name: rawName,
    market: marketInfo.market,
    subMarket: marketInfo.subMarket,
    pinyin: pinyin || null,
    source: 'eastmoney.suggest',
    aliases: [
      pinyin || '',
      rawCode,
      item?.UnifiedCode || '',
      item?.QuoteID || '',
      securityTypeName,
    ].map((token) => String(token || '').trim()).filter(Boolean),
  };
}

function computeSuggestScore(item = {}, keyword = '') {
  const query = normalizeSuggestKeyword(keyword);
  if (!query) return 0;

  const code = normalizeSuggestKeyword(item?.code || '');
  const name = normalizeSuggestKeyword(item?.name || '');
  const pinyin = normalizeSuggestKeyword(item?.pinyin || '');
  const aliases = Array.isArray(item?.aliases)
    ? item.aliases.map((token) => normalizeSuggestKeyword(token)).filter(Boolean)
    : [];

  let score = 0;
  if (code && code === query) score += 120;
  if (pinyin && pinyin === query) score += 110;
  if (name && name === query) score += 100;
  if (code && code.startsWith(query)) score += 70;
  if (pinyin && pinyin.startsWith(query)) score += 65;
  if (name && name.includes(query)) score += 50;
  if (pinyin && pinyin.includes(query)) score += 45;
  if (aliases.some((token) => token === query)) score += 40;
  if (aliases.some((token) => token.startsWith(query))) score += 28;
  if (aliases.some((token) => token.includes(query))) score += 20;
  if (String(item?.source || '').includes('local')) score += 6;
  return score;
}

async function requestEastmoneySuggest({ keyword, count = 20 } = {}) {
  const normalized = String(keyword || '').trim();
  if (!normalized) return [];

  const url = new URL('https://searchapi.eastmoney.com/api/suggest/get');
  url.searchParams.set('input', normalized);
  url.searchParams.set('type', '14');
  url.searchParams.set('count', String(Math.max(1, Math.min(Number(count) || 20, 80))));
  url.searchParams.set('token', 'D43BF722C8E33BDC906FB84D85E326E8');

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (peng-stock-analysis stock-basics suggest)',
    },
  });
  if (!response.ok) {
    throw new HttpError(response.status, `股票建议接口请求失败: ${response.status}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.QuotationCodeTable?.Data)
    ? payload.QuotationCodeTable.Data
    : [];
}

async function requestEastmoneyList({ fs, pageNo = 1, pageSize = 1000 }) {
  const url = new URL('https://80.push2.eastmoney.com/api/qt/clist/get');
  url.searchParams.set('pn', String(pageNo));
  url.searchParams.set('pz', String(pageSize));
  url.searchParams.set('po', '1');
  url.searchParams.set('np', '1');
  url.searchParams.set('fltt', '2');
  url.searchParams.set('invt', '2');
  url.searchParams.set('fid', 'f3');
  url.searchParams.set('fs', fs);
  url.searchParams.set('fields', 'f2,f12,f13,f14,f20,f21,f84,f85,f100,f189');

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (peng-stock-analysis stock-basics)',
    },
  });
  if (!response.ok) {
    throw new HttpError(response.status, `股票基础数据请求失败: ${response.status}`);
  }
  const payload = await response.json();
  return payload?.data || { total: 0, diff: [] };
}

async function syncByEastmoney(config, syncedAt) {
  const pageSize = 1000;
  const maxPages = 25;
  const maxRecords = 30000;
  const rows = [];
  let total = Number.POSITIVE_INFINITY;
  let pageNo = 1;

  while (pageNo <= maxPages && rows.length < total && rows.length < maxRecords) {
    const data = await requestEastmoneyList({
      fs: config.fs,
      pageNo,
      pageSize,
    });
    const diff = data?.diff || [];
    total = Number(data?.total || diff.length || 0);
    if (!diff.length) break;

    rows.push(...diff);
    if (diff.length < pageSize) break;
    pageNo += 1;
  }

  return rows
    .map((item) => {
      const rawCode = String(item?.f12 || '').trim();
      const rawName = String(item?.f14 || '').trim();
      if (!rawCode || !rawName) return null;
      const code = normalizeBasicCodeByMarket(rawCode, config.market);
      const f13 = Number(item?.f13);
      return {
        market: config.market,
        subMarket: config.subMarketByF13[f13] || String(f13 || ''),
        code,
        name: rawName,
        sector: String(item?.f100 || '').trim() || null,
        industry: String(item?.f100 || '').trim() || null,
        latestPrice: positiveNumberOrNull(item?.f2),
        totalShares: positiveNumberOrNull(item?.f85),
        floatShares: positiveNumberOrNull(item?.f84),
        totalMarketCap: positiveNumberOrNull(item?.f20),
        floatMarketCap: positiveNumberOrNull(item?.f21),
        listingDate: formatListingDateCompact(item?.f189),
        source: 'eastmoney.push2.clist',
        syncedAt,
      };
    })
    .filter(Boolean);
}

async function syncABySina(syncedAt) {
  const countResp = await fetch(
    'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount?node=hs_a',
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (peng-stock-analysis stock-basics sina)',
      },
    },
  );
  if (!countResp.ok) {
    throw new HttpError(countResp.status, `新浪A股计数请求失败: ${countResp.status}`);
  }

  const total = parseSinaCount(await countResp.text());
  if (!total) {
    throw new HttpError(502, '新浪A股计数为空');
  }

  const pageSize = 500;
  const pages = Math.ceil(total / pageSize);
  const rows = [];

  for (let page = 1; page <= pages; page += 1) {
    const url = new URL('https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeDataSimple');
    url.searchParams.set('page', String(page));
    url.searchParams.set('num', String(pageSize));
    url.searchParams.set('sort', 'symbol');
    url.searchParams.set('asc', '1');
    url.searchParams.set('node', 'hs_a');
    url.searchParams.set('symbol', '');
    url.searchParams.set('_s_r_a', 'page');

    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (peng-stock-analysis stock-basics sina)',
      },
    });
    if (!resp.ok) {
      throw new HttpError(resp.status, `新浪A股列表请求失败: ${resp.status}`);
    }
    const payload = await resp.json();
    if (!Array.isArray(payload) || !payload.length) {
      if (page <= 2) {
        throw new HttpError(502, '新浪A股列表为空');
      }
      break;
    }

    rows.push(...payload);
  }

  return rows
    .map((item) => {
      const code = normalizeStockCode(item?.code || '');
      const name = String(item?.name || '').trim();
      if (!code || !/^\d{6}$/.test(code) || !name) return null;
      return {
        market: 'A',
        subMarket: inferAStockSubMarket(item),
        code,
        name,
        sector: null,
        industry: null,
        source: 'sina.hqnode.hs_a',
        syncedAt,
      };
    })
    .filter(Boolean);
}

async function syncUSByNasdaq(syncedAt) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (peng-stock-analysis stock-basics nasdaqtrader)',
  };

  const [nasdaqResp, otherResp] = await Promise.all([
    fetch('https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt', { headers }),
    fetch('https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt', { headers }),
  ]);

  if (!nasdaqResp.ok) {
    throw new HttpError(nasdaqResp.status, `Nasdaq列表请求失败: ${nasdaqResp.status}`);
  }
  if (!otherResp.ok) {
    throw new HttpError(otherResp.status, `Other列表请求失败: ${otherResp.status}`);
  }

  const [nasdaqText, otherText] = await Promise.all([nasdaqResp.text(), otherResp.text()]);
  const nasdaqRows = parsePipeTable(nasdaqText);
  const otherRows = parsePipeTable(otherText);

  const result = [];
  nasdaqRows.forEach((item) => {
    const symbol = normalizeStockCode(item.Symbol || '');
    const name = String(item['Security Name'] || '').trim();
    if (!symbol || !name) return;
    if (String(item['Test Issue'] || '').toUpperCase() === 'Y') return;
    result.push({
      market: 'US',
      subMarket: 'NASDAQ',
      code: symbol,
      name,
      sector: null,
      industry: null,
      source: 'nasdaqtrader.symdir',
      syncedAt,
    });
  });

  const exchangeMap = {
    N: 'NYSE',
    A: 'NYSEMKT',
    P: 'NYSEARCA',
    Z: 'BATS',
    V: 'IEX',
  };
  otherRows.forEach((item) => {
    const symbol = normalizeStockCode(item['ACT Symbol'] || '');
    const name = String(item['Security Name'] || '').trim();
    if (!symbol || !name) return;
    if (String(item['Test Issue'] || '').toUpperCase() === 'Y') return;
    result.push({
      market: 'US',
      subMarket: exchangeMap[String(item.Exchange || '').trim().toUpperCase()] || String(item.Exchange || '').trim().toUpperCase() || 'OTHER',
      code: symbol,
      name,
      sector: null,
      industry: null,
      source: 'nasdaqtrader.symdir',
      syncedAt,
    });
  });

  return result;
}

async function syncHKByHkex(syncedAt) {
  const resp = await fetch(
    'https://www.hkex.com.hk/eng/services/trading/securities/securitieslists/ListOfSecurities.xlsx',
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (peng-stock-analysis stock-basics hkex)',
      },
    },
  );
  if (!resp.ok) {
    throw new HttpError(resp.status, `HKEX列表请求失败: ${resp.status}`);
  }

  const buffer = Buffer.from(await resp.arrayBuffer());
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    throw new HttpError(502, 'HKEX列表解析失败：无工作表');
  }

  const maxRow = inferHkexMaxRow(sheet);
  sheet['!ref'] = `A1:R${Math.max(maxRow, 1000)}`;
  const rows = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
  });

  if (!rows.length) {
    throw new HttpError(502, 'HKEX列表为空');
  }

  const header = rows[2] || [];
  const stockCodeIdx = header.findIndex((h) => String(h || '').trim() === 'Stock Code');
  const nameIdx = header.findIndex((h) => String(h || '').trim() === 'Name of Securities');
  const categoryIdx = header.findIndex((h) => String(h || '').trim() === 'Category');
  const subCategoryIdx = header.findIndex((h) => String(h || '').trim() === 'Sub-Category');

  if (stockCodeIdx < 0 || nameIdx < 0 || categoryIdx < 0 || subCategoryIdx < 0) {
    throw new HttpError(502, 'HKEX列表字段不完整');
  }

  const items = rows
    .slice(3)
    .map((row) => {
      const category = String(row[categoryIdx] || '').trim();
      const subCategory = String(row[subCategoryIdx] || '').trim();
      if (category !== 'Equity') return null;
      if (!subCategory.toLowerCase().includes('equity securities')) return null;

      const rawCode = String(row[stockCodeIdx] || '').trim();
      const name = String(row[nameIdx] || '').trim();
      if (!rawCode || !name) return null;

      const code = normalizeBasicCodeByMarket(rawCode, 'HK');
      if (!/^\d{5}$/.test(code)) return null;

      return {
        market: 'HK',
        subMarket: subCategory.toLowerCase().includes('gem') ? 'GEM' : 'HK',
        code,
        name,
        sector: null,
        industry: null,
        source: 'hkex.listofsecurities',
        syncedAt,
      };
    })
    .filter(Boolean);

  const codeList = items.map((item) => item.code);
  const zhNameMap = await requestTencentHkNameMap(codeList);
  return items.map((item) => {
    const zhName = String(zhNameMap.get(item.code) || '').trim();
    if (!zhName) return item;
    return {
      ...item,
      name: zhName,
      source: `${item.source}+tencent.qt`,
    };
  });
}

async function requestTencentHkNameMap(codes = []) {
  const normalizedCodes = Array.from(new Set(
    (Array.isArray(codes) ? codes : [])
      .map((code) => String(code || '').trim())
      .filter((code) => /^\d{5}$/.test(code)),
  ));

  if (!normalizedCodes.length) return new Map();

  const chunks = splitToChunks(normalizedCodes, 180);
  const result = new Map();

  for (const chunk of chunks) {
    const symbols = chunk.map((code) => `hk${code}`).join(',');
    const url = `https://qt.gtimg.cn/q=${symbols}`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (peng-stock-analysis stock-basics tencent)',
      },
    });

    if (!resp.ok) {
      throw new HttpError(resp.status, `腾讯港股名称请求失败: ${resp.status}`);
    }

    const buffer = await resp.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buffer);
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    lines.forEach((line) => {
      const matched = line.match(/^v_hk(\d{5})="([^"]*)";?$/);
      if (!matched) return;
      const [, code, payload] = matched;
      const parts = String(payload || '').split('~');
      const zhName = String(parts[1] || '').trim();
      if (!zhName || zhName === '--') return;
      result.set(code, zhName);
    });
  }

  return result;
}

async function syncMarketWithProviders(market, syncedAt) {
  const config = MARKET_SYNC_CONFIG.find((item) => item.market === market);
  const providersByMarket = {
    A: [
      { name: 'eastmoney.push2.clist', run: () => syncByEastmoney(config, syncedAt) },
      { name: 'sina.hqnode.hs_a', run: () => syncABySina(syncedAt) },
    ],
    HK: [
      { name: 'eastmoney.push2.clist', run: () => syncByEastmoney(config, syncedAt) },
      { name: 'hkex.listofsecurities', run: () => syncHKByHkex(syncedAt) },
    ],
    US: [
      { name: 'eastmoney.push2.clist', run: () => syncByEastmoney(config, syncedAt) },
      { name: 'nasdaqtrader.symdir', run: () => syncUSByNasdaq(syncedAt) },
    ],
  };

  const providers = providersByMarket[market] || [];
  const errors = [];

  for (const provider of providers) {
    try {
      const items = await provider.run();
      if (!Array.isArray(items) || !items.length) {
        throw new HttpError(502, `${provider.name} 返回空数据`);
      }
      stockBasicsRepository.upsertMany(items);
      return {
        market,
        total: items.length,
        source: provider.name,
        fallbackErrors: errors,
      };
    } catch (error) {
      errors.push({
        source: provider.name,
        message: error.message,
      });
    }
  }

  return {
    market,
    total: 0,
    source: null,
    error: errors[errors.length - 1]?.message || '全部数据源失败',
    fallbackErrors: errors,
  };
}

export const stockBasicsService = {
  async ensureInitialSync() {
    if (initialSyncPromise) return initialSyncPromise;

    const existing = stockBasicsRepository.countAll();
    if (existing > 0) {
      return {
        skipped: true,
        reason: 'stock_basics already initialized',
        existing,
      };
    }

    initialSyncPromise = this.syncBasics()
      .finally(() => {
        initialSyncPromise = null;
      });

    return initialSyncPromise;
  },

  async syncBasics() {
    const syncedAt = new Date().toISOString();
    const marketStats = [];

    for (const market of ['A', 'HK', 'US']) {
      const stat = await syncMarketWithProviders(market, syncedAt);
      marketStats.push(stat);
    }

    const aFundamentals = await syncAFundamentalsBulk(syncedAt);
    const aStat = marketStats.find((item) => item.market === 'A');
    if (aStat) {
      aStat.fundamentals = aFundamentals;
      aStat.quality = aFundamentals.quality;
    }

    const failedMarkets = marketStats
      .filter((item) => Number(item.total || 0) <= 0)
      .map((item) => ({
        market: item.market,
        message: item.error || '同步失败',
      }));

    return {
      syncedAt,
      total: marketStats.reduce((sum, item) => sum + Number(item.total || 0), 0),
      markets: marketStats,
      aFundamentals,
      failedMarkets,
      failOpen: true,
    };
  },

  searchBasics({ q = '', market = '', page = 1, limit = 50 } = {}) {
    const normalizedPage = Math.max(1, Number(page) || 1);
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
    const offset = (normalizedPage - 1) * normalizedLimit;
    const payload = stockBasicsRepository.search({
      q: String(q || '').trim(),
      market: String(market || '').trim().toUpperCase(),
      limit: normalizedLimit,
      offset,
    });

    return {
      page: normalizedPage,
      limit: normalizedLimit,
      total: payload.total,
      items: payload.items,
    };
  },

  async suggestBasics({ q = '', market = '', limit = 20 } = {}) {
    const keyword = String(q || '').trim();
    const normalizedMarket = String(market || '').trim().toUpperCase();
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 20, 80));
    if (!keyword) {
      return {
        keyword: '',
        limit: normalizedLimit,
        total: 0,
        items: [],
      };
    }

    const localPayload = stockBasicsRepository.search({
      q: keyword,
      market: normalizedMarket,
      limit: Math.max(normalizedLimit * 2, 40),
      offset: 0,
    });
    const localItems = (localPayload.items || []).map((item) => ({
      code: item.code,
      name: item.name,
      market: item.market,
      subMarket: item.subMarket || '',
      pinyin: null,
      source: 'stock.basics.local',
      aliases: [
        item.code,
        item.name,
        item.subMarket ? `${item.subMarket}${item.code}` : '',
        item.subMarket ? `${item.code}.${item.subMarket}` : '',
      ].filter(Boolean),
    }));

    let remoteItems = [];
    const shouldFetchRemote = (
      keyword.length >= 2
      && /^[A-Za-z0-9.\-^]+$/.test(keyword)
      && (!normalizedMarket || ['A', 'HK', 'US'].includes(normalizedMarket))
    );
    if (shouldFetchRemote) {
      try {
        const rows = await requestEastmoneySuggest({
          keyword,
          count: Math.max(normalizedLimit * 2, 20),
        });
        remoteItems = rows
          .map(mapEastmoneySuggestItem)
          .filter(Boolean)
          .filter((item) => !normalizedMarket || item.market === normalizedMarket);
      } catch {}
    }

    const mergedMap = new Map();
    [...localItems, ...remoteItems].forEach((item) => {
      const code = String(item?.code || '').trim().toUpperCase();
      const marketCode = String(item?.market || '').trim().toUpperCase();
      if (!code || !marketCode) return;
      const key = `${marketCode}:${code}`;
      const existing = mergedMap.get(key);
      if (!existing) {
        mergedMap.set(key, {
          ...item,
          aliases: Array.isArray(item.aliases) ? item.aliases : [],
        });
        return;
      }

      const mergedAliases = Array.from(new Set([
        ...(Array.isArray(existing.aliases) ? existing.aliases : []),
        ...(Array.isArray(item.aliases) ? item.aliases : []),
      ]));
      const preferRemote = String(item.source || '').includes('eastmoney')
        && !String(existing.source || '').includes('eastmoney');
      mergedMap.set(key, {
        ...(preferRemote ? item : existing),
        aliases: mergedAliases,
        pinyin: item.pinyin || existing.pinyin || null,
      });
    });

    const items = Array.from(mergedMap.values())
      .map((item) => ({
        ...item,
        _score: computeSuggestScore(item, keyword),
      }))
      .sort((a, b) => b._score - a._score || String(a.code).localeCompare(String(b.code)))
      .slice(0, normalizedLimit)
      .map(({ _score, ...item }) => item);

    return {
      keyword,
      limit: normalizedLimit,
      total: items.length,
      items,
    };
  },

  async getBasicDetail(code, { market = '', localOnly = false } = {}) {
    const normalizedCode = normalizeStockCode(code);
    if (!normalizedCode) {
      throw new HttpError(400, '股票代码不能为空');
    }

    const normalizedMarket = String(market || '').trim().toUpperCase();
    let local = normalizedMarket
      ? stockBasicsRepository.findByMarketAndCode(normalizedMarket, normalizedCode)
      : stockBasicsRepository.findByCode(normalizedCode)?.[0] || null;

    const isAStock = (
      String(local?.market || normalizedMarket || '').toUpperCase() === 'A'
      || /^\d{6}$/.test(normalizedCode)
    );
    if (!localOnly && isAStock && shouldRefreshFundamentals(local)) {
      await syncAStockFundamentals(local, normalizedCode).catch(() => null);
      local = normalizedMarket
        ? stockBasicsRepository.findByMarketAndCode(normalizedMarket, normalizedCode)
        : stockBasicsRepository.findByCode(normalizedCode)?.[0] || local;
    }

    let quote = null;
    let quoteError = null;
    if (!localOnly) {
      try {
        quote = await stockDataService.getQuote(normalizedCode);
      } catch (error) {
        quoteError = error.message;
      }
    }

    return {
      code: normalizedCode,
      local,
      fundamentals: local ? {
        latest: positiveNumberOrNull(local.latestPrice),
        totalShares: positiveNumberOrNull(local.totalShares),
        floatShares: positiveNumberOrNull(local.floatShares),
        totalMarketCap: positiveNumberOrNull(local.totalMarketCap),
        floatMarketCap: positiveNumberOrNull(local.floatMarketCap),
        industry: local.industry || local.sector || null,
        listingDate: local.listingDate || null,
        mainBusiness: local.mainBusiness || null,
        businessScope: local.businessScope || null,
        companyProfile: local.companyProfile || null,
        tradingHours: getOfficialStockTradingHours(local || {}) || null,
      } : null,
      fundamentalItems: buildFundamentalItems(normalizedCode, local, quote),
      remoteQuote: quote,
      remoteQuoteError: quoteError,
      localOnly,
      failOpen: true,
    };
  },
};

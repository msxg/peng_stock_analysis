import { createHash } from 'crypto';
import { normalizeSourceDateTime } from '../../../lib/focus-news-time.js';
import { env } from '../../config/env.js';
import { systemRepository } from '../../repositories/systemRepository.js';
import { HttpError } from '../../utils/httpError.js';
import { BaseNewsProvider } from './baseNewsProvider.js';

const TUSHARE_NEWS_CATALOG = [
  {
    categoryKey: 'news_data',
    parentCategoryKey: '',
    name: '资讯数据',
    level: 1,
    sortOrder: 10,
    isActive: true,
    apiName: '',
  },
  {
    categoryKey: 'news',
    parentCategoryKey: 'news_data',
    name: '新闻快讯',
    level: 2,
    sortOrder: 20,
    isActive: true,
    apiName: 'news',
  },
  {
    categoryKey: 'major_news',
    parentCategoryKey: 'news_data',
    name: '新闻通讯',
    level: 2,
    sortOrder: 30,
    isActive: true,
    apiName: 'major_news',
  },
  {
    categoryKey: 'cctv_news',
    parentCategoryKey: 'news_data',
    name: '新闻联播文字稿',
    level: 2,
    sortOrder: 40,
    isActive: true,
    apiName: 'cctv_news',
  },
  {
    categoryKey: 'anns_d',
    parentCategoryKey: 'news_data',
    name: '上市公司公告',
    level: 2,
    sortOrder: 50,
    isActive: true,
    apiName: 'anns_d',
  },
  {
    categoryKey: 'irm_qa_sh',
    parentCategoryKey: 'news_data',
    name: '上证e互动问答',
    level: 2,
    sortOrder: 60,
    isActive: true,
    apiName: 'irm_qa_sh',
  },
  {
    categoryKey: 'irm_qa_sz',
    parentCategoryKey: 'news_data',
    name: '深证互动易问答',
    level: 2,
    sortOrder: 70,
    isActive: true,
    apiName: 'irm_qa_sz',
  },
];

const TUSHARE_NEWS_WEB_SOURCES = [
  { key: 'xq', name: '雪球' },
  { key: 'yicai', name: '第一财经' },
  { key: 'fenghuang', name: '凤凰' },
  { key: '10jqka', name: '同花顺' },
  { key: 'jinrongjie', name: '金融界' },
  { key: 'sina', name: '新浪财经' },
  { key: 'yuncaijing', name: '云财经' },
  { key: 'cls', name: '财联社' },
  { key: 'eastmoney', name: '东方财富' },
  { key: 'wallstreetcn', name: '华尔街见闻' },
];

const TUSHARE_WEB_COOKIE_CONFIG_KEY = 'TUSHARE_WEB_COOKIE';
const COOKIE_WARNING_THROTTLE_MS = 30 * 60 * 1000;
const invalidCookieWarnings = new Map();

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toHash(text = '') {
  return createHash('sha1').update(String(text || '')).digest('hex');
}

function fingerprintCookie(cookie = '') {
  const text = String(cookie || '').trim();
  if (!text) return 'empty';
  return toHash(text).slice(0, 12);
}

function todayText(dateInput = new Date()) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function normalizeDateText(input = '', fallback = '') {
  const text = String(input || '').trim() || String(fallback || '').trim();
  if (!text) return '';
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function shiftDateText(input = '', days = 0) {
  const text = normalizeDateText(input);
  if (!text) return '';
  const [year, month, day] = text.split('-').map((item) => Number(item));
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + Number(days || 0));
  return todayText(date);
}

function decodeHtml(text = '') {
  const source = String(text || '');
  return source
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
}

function stripHtml(text = '') {
  return decodeHtml(String(text || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function clampTitle(text = '', maxLength = 120) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  if (raw.length <= maxLength) return raw;
  const clipped = raw.slice(0, maxLength);
  const separatorIndex = Math.max(
    clipped.lastIndexOf('，'),
    clipped.lastIndexOf(','),
    clipped.lastIndexOf('、'),
    clipped.lastIndexOf('|'),
    clipped.lastIndexOf('；'),
    clipped.lastIndexOf(';'),
    clipped.lastIndexOf(' '),
  );
  if (separatorIndex >= Math.floor(maxLength * 0.5)) {
    return clipped.slice(0, separatorIndex).trim();
  }
  return clipped.trim();
}

function toNewsTitle(content = '') {
  const TITLE_MAX_LENGTH = 120;
  const text = String(content || '').trim();
  if (!text) return '无标题';
  const pipeTitle = text.includes('|')
    ? text.split('|').map((item) => item.trim()).find(Boolean)
    : '';
  if (pipeTitle) {
    return clampTitle(pipeTitle, TITLE_MAX_LENGTH) || '无标题';
  }
  // Keep decimal dots (e.g. 0.08 / 0 .08 / 0. 08) from being treated as sentence breaks.
  const protectedText = text.replace(/(\d)\s*\.\s*(\d)/g, '$1__DECIMAL_DOT__$2');
  const short = (protectedText.split(/[。！？.!?；;]/)[0] || protectedText)
    .replace(/__DECIMAL_DOT__/g, '.')
    .trim() || text;
  return clampTitle(short, TITLE_MAX_LENGTH)
    || clampTitle(text, TITLE_MAX_LENGTH)
    || '无标题';
}

function normalizeWebDateTime(raw = '', day = '', options = {}) {
  const {
    adjustFutureToPreviousDay = false,
    nowTs = Date.now(),
    futureToleranceMinutes = 5,
  } = options || {};
  const text = String(raw || '').trim();
  if (!text) return '';
  if (/^\d{2}:\d{2}$/.test(text)) {
    const dateText = normalizeDateText(day, todayText(new Date(nowTs))) || todayText(new Date(nowTs));
    const timeText = `${text}:00`;
    let resolvedDateText = dateText;
    if (adjustFutureToPreviousDay && dateText === todayText(new Date(nowTs))) {
      const candidate = normalizeSourceDateTime(`${dateText} ${timeText}`);
      const candidateTs = candidate ? new Date(candidate).getTime() : 0;
      const toleranceMs = Math.max(1, Number(futureToleranceMinutes || 5)) * 60 * 1000;
      if (candidateTs && candidateTs - nowTs > toleranceMs) {
        const previousDay = shiftDateText(dateText, -1);
        if (previousDay) resolvedDateText = previousDay;
      }
    }
    return `${resolvedDateText} ${timeText}`;
  }
  if (/^\d{2}:\d{2}:\d{2}$/.test(text)) {
    const dateText = normalizeDateText(day, todayText(new Date(nowTs))) || todayText(new Date(nowTs));
    let resolvedDateText = dateText;
    if (adjustFutureToPreviousDay && dateText === todayText(new Date(nowTs))) {
      const candidate = normalizeSourceDateTime(`${dateText} ${text}`);
      const candidateTs = candidate ? new Date(candidate).getTime() : 0;
      const toleranceMs = Math.max(1, Number(futureToleranceMinutes || 5)) * 60 * 1000;
      if (candidateTs && candidateTs - nowTs > toleranceMs) {
        const previousDay = shiftDateText(dateText, -1);
        if (previousDay) resolvedDateText = previousDay;
      }
    }
    return `${resolvedDateText} ${text}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text} 00:00:00`;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(text)) {
    return text.replace('T', ' ');
  }
  return text;
}

function normalizeApiDateTime(raw = '') {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)} 00:00:00`;
  }
  if (/^\d{14}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)} ${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}`;
  }
  return normalizeWebDateTime(text, '');
}

function toObjByFields(fields = [], row = []) {
  const obj = {};
  fields.forEach((field, index) => {
    obj[field] = row[index];
  });
  return obj;
}

async function callTushare(apiName, params = {}, fields = '') {
  if (!env.TUSHARE_TOKEN) {
    throw new HttpError(400, 'TUSHARE_TOKEN 未配置');
  }

  const url = String(env.TUSHARE_BASE_URL || 'https://api.tushare.pro').trim();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (peng-stock-analysis focus-news provider=tushare)',
    },
    body: JSON.stringify({
      api_name: apiName,
      token: env.TUSHARE_TOKEN,
      params,
      fields,
    }),
  });

  if (!response.ok) {
    throw new HttpError(502, `Tushare 请求失败: HTTP ${response.status}`);
  }
  const payload = await response.json().catch(() => ({}));
  if (Number(payload?.code) !== 0) {
    throw new HttpError(502, `Tushare 接口异常: ${payload?.msg || '未知错误'}`);
  }
  const data = payload?.data || {};
  const rows = Array.isArray(data?.items) ? data.items : [];
  const fieldsArr = Array.isArray(data?.fields) ? data.fields : [];
  return rows.map((row) => toObjByFields(fieldsArr, Array.isArray(row) ? row : []));
}

function buildApiParams(apiName, params = {}) {
  const startDate = String(params.startDate || '').trim();
  const endDate = String(params.endDate || '').trim();
  const apiParams = {};

  if (apiName === 'news') {
    if (startDate) apiParams.start_date = `${startDate} 00:00:00`;
    if (endDate) apiParams.end_date = `${endDate} 23:59:59`;
    apiParams.src = String(params.src || 'sina').trim();
    return apiParams;
  }

  if (startDate) apiParams.start_date = startDate.replace(/-/g, '');
  if (endDate) apiParams.end_date = endDate.replace(/-/g, '');
  return apiParams;
}

function pickWebSources(params = {}) {
  const input = Array.isArray(params.newsSources)
    ? params.newsSources
    : String(params.newsSources || '').split(',');
  const keys = input
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (!keys.length) {
    return TUSHARE_NEWS_WEB_SOURCES;
  }
  const keySet = new Set(keys);
  return TUSHARE_NEWS_WEB_SOURCES.filter((item) => keySet.has(item.key));
}

function resolveTushareWebCookie(params = {}) {
  const directCookie = String(params.webCookie || '').trim();
  if (directCookie) return directCookie;

  const configCookie = String(systemRepository.getConfigValue(TUSHARE_WEB_COOKIE_CONFIG_KEY) || '').trim();
  if (configCookie) return configCookie;

  return String(env.TUSHARE_WEB_COOKIE || '').trim();
}

function clearInvalidCookieWarning(cookie = '') {
  const fingerprint = fingerprintCookie(cookie);
  invalidCookieWarnings.delete(fingerprint);
}

function warnInvalidCookie(cookie = '', detail = '') {
  const fingerprint = fingerprintCookie(cookie);
  const now = Date.now();
  const lastWarnAt = invalidCookieWarnings.get(fingerprint) || 0;
  if (now - lastWarnAt < COOKIE_WARNING_THROTTLE_MS) {
    return;
  }
  invalidCookieWarnings.set(fingerprint, now);
  const suffix = String(detail || '').trim();
  console.warn(
    `[focus-news][provider=tushare][cookie-invalid] cookie=${fingerprint} ${suffix}请更新系统配置 ${TUSHARE_WEB_COOKIE_CONFIG_KEY}（或环境变量 TUSHARE_WEB_COOKIE）。`,
  );
}

function isLoggedInNewsPage(html = '') {
  const text = String(html || '');
  if (!text) return false;
  if (text.includes('id="login-user-btn"') && text.includes('退出登录')) return true;
  if (text.includes('class="none_class news_item"')) return true;
  if (text.includes('news_content') && text.includes('news_datetime')) return true;
  return false;
}

function parseItemsFromNewsHtml(html = '', { sourceKey = '', sourceName = '', day = '' } = {}) {
  const text = String(html || '');
  const rows = [];
  const itemRegex = /<div class="none_class news_item">\s*<div class="news_datetime">([\s\S]*?)<\/div>\s*<div class="news_content">([\s\S]*?)<\/div>\s*<\/div>/g;
  let matched = itemRegex.exec(text);
  while (matched) {
    const rawDateTime = stripHtml(matched[1] || '');
    const publishedAtForId = normalizeWebDateTime(rawDateTime, day, {
      adjustFutureToPreviousDay: false,
    });
    const publishedAt = normalizeWebDateTime(rawDateTime, day, {
      adjustFutureToPreviousDay: true,
      nowTs: Date.now(),
      futureToleranceMinutes: 5,
    });
    const content = stripHtml(matched[2] || '');
    const title = toNewsTitle(content);
    if (content) {
      const hash = toHash(`${sourceKey}|${publishedAtForId}|${content}`);
      rows.push({
        id: `web:${sourceKey}:${hash.slice(0, 24)}`,
        title,
        content,
        summary: content.slice(0, 300),
        src: sourceName || 'Tushare',
        source: sourceName || 'Tushare',
        datetime: publishedAt,
        providerCategoryKey: 'news',
        meta: {
          sourceType: 'tushare.web.news',
          sourceKey,
        },
      });
    }
    matched = itemRegex.exec(text);
  }
  return rows;
}

export class TushareNewsProvider extends BaseNewsProvider {
  getKey() {
    return 'tushare';
  }

  getDisplayName() {
    return 'Tushare 资讯源';
  }

  async pullCatalog() {
    return TUSHARE_NEWS_CATALOG.map((item) => ({
      ...item,
      meta: {
        source: 'tushare.document.catalog',
        apiName: item.apiName || null,
      },
    }));
  }

  async pullItems(params = {}) {
    const categoryKey = String(params.categoryKey || 'news').trim();
    const category = TUSHARE_NEWS_CATALOG.find((item) => item.categoryKey === categoryKey);
    if (!category || !category.apiName) {
      throw new HttpError(400, `不支持的 Tushare 资讯分类: ${categoryKey}`);
    }

    const limit = Number.isFinite(Number(params.limit)) ? Math.max(1, Math.min(Number(params.limit), 5000)) : 200;
    const startDate = normalizeDateText(params.startDate || '', todayText());
    const endDate = normalizeDateText(params.endDate || '', startDate || todayText());
    const apiParams = buildApiParams(category.apiName, {
      ...params,
      startDate,
      endDate,
    });

    let apiError = null;
    try {
      const rows = await callTushare(category.apiName, apiParams);
      const normalized = rows.slice(0, limit).map((item) => this.normalizeItem({
        ...item,
        providerCategoryKey: category.categoryKey,
      }));
      if (normalized.length > 0) {
        return normalized;
      }
    } catch (error) {
      apiError = error;
    }

    if (category.apiName === 'news') {
      const cookie = resolveTushareWebCookie(params);
      if (cookie) {
        const webRows = await this.pullNewsItemsFromWeb({
          limit,
          startDate,
          endDate,
          cookie,
          newsSources: params.newsSources,
        });
        if (webRows.length > 0) {
          return webRows.map((item) => this.normalizeItem({
            ...item,
            providerCategoryKey: category.categoryKey,
          }));
        }
      }
    }

    if (apiError) throw apiError;
    return [];
  }

  async pullNewsItemsFromWeb(params = {}) {
    const cookie = String(params.cookie || '').trim();
    if (!cookie) {
      return [];
    }

    const limit = Number.isFinite(Number(params.limit))
      ? Math.max(1, Math.min(Number(params.limit), 5000))
      : 200;
    const day = normalizeDateText(params.endDate || params.startDate || '', todayText()) || todayText();
    const sources = pickWebSources(params);
    const deduped = new Map();
    let checkedLogin = false;

    for (const source of sources) {
      if (deduped.size >= limit) break;
      const url = `https://tushare.pro/news/${encodeURIComponent(source.key)}`;
      const response = await fetch(url, {
        headers: {
          Cookie: cookie,
          Referer: 'https://tushare.pro/news',
          'User-Agent': 'Mozilla/5.0 (peng-stock-analysis focus-news provider=tushare web-fallback)',
        },
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          warnInvalidCookie(cookie, `status=${response.status} source=${source.key} `);
        }
        throw new HttpError(502, `Tushare 网页抓取失败: ${source.key}, HTTP ${response.status}`);
      }
      const html = await response.text();
      if (!checkedLogin) {
        checkedLogin = true;
        const isLoggedIn = isLoggedInNewsPage(html);
        if (!isLoggedIn) {
          warnInvalidCookie(cookie, `source=${source.key} `);
          throw new HttpError(401, `Tushare 网页会话无效，请更新系统配置 ${TUSHARE_WEB_COOKIE_CONFIG_KEY}`);
        }
        clearInvalidCookieWarning(cookie);
      }

      const rows = parseItemsFromNewsHtml(html, {
        sourceKey: source.key,
        sourceName: source.name,
        day,
      });
      rows.forEach((item) => {
        if (deduped.size >= limit) return;
        if (!deduped.has(item.id)) {
          deduped.set(item.id, item);
        }
      });
    }

    return Array.from(deduped.values()).slice(0, limit);
  }

  normalizeItem(sourceItem = {}) {
    const title = String(
      sourceItem.title
      || sourceItem.name
      || sourceItem.content
      || sourceItem.reason
      || '',
    ).trim();
    const content = String(
      sourceItem.content
      || sourceItem.desc
      || sourceItem.reason
      || '',
    ).trim();
    const publishedAtRaw = String(
      sourceItem.datetime
      || sourceItem.pub_time
      || sourceItem.ann_date
      || sourceItem.end_date
      || sourceItem.date
      || '',
    ).trim();
    const publishedAt = normalizeSourceDateTime(publishedAtRaw);

    return {
      provider: this.getKey(),
      providerItemId: String(
        sourceItem.id
        || sourceItem.news_id
        || sourceItem.ts_code
        || `${sourceItem.providerCategoryKey || 'news'}:${title}:${publishedAt || publishedAtRaw}`,
      ).trim(),
      providerCategoryKey: String(sourceItem.providerCategoryKey || '').trim(),
      title: title || '无标题',
      summary: String(sourceItem.summary || '').trim(),
      content,
      url: String(sourceItem.url || '').trim() || null,
      sourceName: String(sourceItem.src || sourceItem.source || 'Tushare').trim(),
      author: String(sourceItem.author || '').trim() || null,
      publishedAt: publishedAt || normalizeApiDateTime(publishedAtRaw),
      lang: 'zh-CN',
      region: 'CN',
      tags: [],
      symbols: [],
      meta: sourceItem,
    };
  }
}

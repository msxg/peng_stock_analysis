import { createHash } from 'crypto';
import { normalizeSourceDateTime } from '../../../lib/focus-news-time.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../utils/httpError.js';
import { BaseNewsProvider } from './baseNewsProvider.js';

const XUEQIU_NEWS_CATALOG = [
  {
    categoryKey: 'xueqiu_news',
    parentCategoryKey: '',
    name: '雪球资讯',
    level: 1,
    sortOrder: 10,
    isActive: true,
  },
  {
    categoryKey: 'xueqiu_7x24',
    parentCategoryKey: 'xueqiu_news',
    name: '7x24',
    level: 2,
    sortOrder: 20,
    isActive: true,
    endpoint: '/statuses/livenews/list.json',
  },
];

const XUEQIU_LIVE_ENDPOINT = '/statuses/livenews/list.json';
const XUEQIU_MAX_PAGE_SIZE = 50;
const XUEQIU_MAX_PAGES = 40;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function todayText() {
  const date = new Date();
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function normalizeDateText(input = '', fallback = '') {
  const text = String(input || '').trim() || String(fallback || '').trim();
  if (!text) return '';
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) return '';
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function toWindowStartTs(dateText = '') {
  const text = normalizeDateText(dateText);
  if (!text) return 0;
  const [year, month, day] = text.split('-').map((item) => Number(item));
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

function toWindowEndTs(dateText = '') {
  const text = normalizeDateText(dateText);
  if (!text) return Number.MAX_SAFE_INTEGER;
  const [year, month, day] = text.split('-').map((item) => Number(item));
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

function toHash(text = '') {
  return createHash('sha1').update(String(text || '')).digest('hex');
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

function toTimestamp(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return 0;

  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    if (rawValue > 1e12) return Math.trunc(rawValue);
    if (rawValue > 1e9) return Math.trunc(rawValue * 1000);
    return 0;
  }

  const text = String(rawValue || '').trim();
  if (!text) return 0;
  if (/^\d{13}$/.test(text)) return Number(text);
  if (/^\d{10}$/.test(text)) return Number(text) * 1000;

  const parsed = new Date(text);
  const ts = parsed.getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function pickRows(payload = {}) {
  const candidates = [
    payload?.items,
    payload?.list,
    payload?.data?.items,
    payload?.data?.list,
    payload?.data?.news,
    payload?.data?.statuses,
  ];
  for (const item of candidates) {
    if (Array.isArray(item)) return item;
  }
  return [];
}

function toNumericCursor(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.trunc(num);
}

function pickNextMaxId(payload = {}, rows = [], currentMaxId = -1) {
  const directValues = [
    payload?.next_max_id,
    payload?.nextMaxId,
    payload?.max_id,
    payload?.maxId,
    payload?.data?.next_max_id,
    payload?.data?.nextMaxId,
  ];
  for (const value of directValues) {
    const cursor = toNumericCursor(value);
    if (cursor !== null) return cursor;
  }

  const lastRow = rows[rows.length - 1] || {};
  const rowCursor = toNumericCursor(lastRow.id || lastRow.news_id || lastRow.last_id);
  if (rowCursor !== null && rowCursor !== currentMaxId) return rowCursor;
  return null;
}

function toBool(value, fallback = false) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return Boolean(fallback);
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return Boolean(fallback);
}

function isBrowserFallbackEnabled() {
  return toBool(env.XUEQIU_BROWSER_FALLBACK_ENABLED, true);
}

function isBrowserHeadless() {
  return toBool(env.XUEQIU_BROWSER_HEADLESS, true);
}

function toCookieList(cookieHeader = '', baseUrl = '') {
  const hostname = new URL(baseUrl).hostname;
  return String(cookieHeader || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const index = item.indexOf('=');
      if (index <= 0) return null;
      const name = item.slice(0, index).trim();
      const value = item.slice(index + 1).trim();
      if (!name) return null;
      return {
        name,
        value,
        domain: hostname,
        path: '/',
      };
    })
    .filter(Boolean);
}

async function callXueqiuLiveNews(params = {}) {
  const maxId = toNumericCursor(params.maxId);
  const sinceId = toNumericCursor(params.sinceId);
  const count = Number.isFinite(Number(params.count))
    ? Math.max(1, Math.min(Math.trunc(Number(params.count)), XUEQIU_MAX_PAGE_SIZE))
    : 20;

  const baseUrl = String(env.XUEQIU_BASE_URL || 'https://xueqiu.com').trim().replace(/\/+$/, '');
  const url = new URL(XUEQIU_LIVE_ENDPOINT, `${baseUrl}/`);
  url.searchParams.set('max_id', String(maxId ?? -1));
  url.searchParams.set('since_id', String(sinceId ?? -1));
  url.searchParams.set('count', String(count));

  const cookie = String(params.cookie || '').trim();
  const headers = {
    Accept: 'application/json, text/plain, */*',
    Referer: String(env.XUEQIU_REFERER || 'https://xueqiu.com/').trim(),
    'User-Agent': String(
      env.XUEQIU_USER_AGENT
      || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    ).trim(),
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (cookie) headers.Cookie = cookie;

  let response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers,
    });
  } catch (error) {
    throw new HttpError(502, `雪球接口网络请求失败: ${error?.message || 'unknown error'}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const preview = String(text || '').trim().slice(0, 120);
    if (response.status === 403) {
      throw new HttpError(
        502,
        `雪球接口返回 403（可能触发风控/IP限制），请配置 XUEQIU_WEB_COOKIE 或在可访问环境重试。${preview ? `详情: ${preview}` : ''}`,
      );
    }
    if (response.status === 401) {
      throw new HttpError(502, '雪球接口返回 401，请检查 XUEQIU_WEB_COOKIE 是否有效');
    }
    throw new HttpError(502, `雪球接口请求失败: HTTP ${response.status}${preview ? `, ${preview}` : ''}`);
  }

  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object') {
    throw new HttpError(502, '雪球接口返回非 JSON 数据');
  }
  return payload;
}

async function createXueqiuBrowserSession(params = {}) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: isBrowserHeadless(),
  });

  const baseUrl = String(env.XUEQIU_BASE_URL || 'https://xueqiu.com').trim().replace(/\/+$/, '');
  const context = await browser.newContext({
    baseURL: `${baseUrl}/`,
    extraHTTPHeaders: {
      Referer: String(env.XUEQIU_REFERER || 'https://xueqiu.com/').trim(),
      'User-Agent': String(
        env.XUEQIU_USER_AGENT
        || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
      ).trim(),
    },
  });

  const cookie = String(params.cookie || '').trim();
  if (cookie) {
    const cookies = toCookieList(cookie, baseUrl);
    if (cookies.length) {
      await context.addCookies(cookies);
    }
  }

  const page = await context.newPage();
  return {
    browser,
    context,
    page,
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

export class XueqiuNewsProvider extends BaseNewsProvider {
  getKey() {
    return 'xueqiu';
  }

  getDisplayName() {
    return '雪球 7x24';
  }

  async pullCatalog() {
    return XUEQIU_NEWS_CATALOG.map((item) => ({
      ...item,
      meta: {
        source: 'xueqiu.catalog',
        endpoint: item.endpoint || null,
      },
    }));
  }

  async pullItems(params = {}) {
    const categoryKey = String(params.categoryKey || '').trim();
    if (categoryKey !== 'xueqiu_7x24') {
      throw new HttpError(400, `不支持的 雪球资讯分类: ${categoryKey}（当前仅支持 xueqiu_7x24）`);
    }

    const limit = Number.isFinite(Number(params.limit)) ? Math.max(1, Math.min(Number(params.limit), 5000)) : 200;
    const today = todayText();
    const startDate = normalizeDateText(params.startDate || '', today) || today;
    const endDate = normalizeDateText(params.endDate || '', startDate) || startDate;
    const startTs = toWindowStartTs(startDate);
    const endTs = toWindowEndTs(endDate);

    let maxId = -1;
    let sinceId = -1;
    const deduped = new Map();
    const seenCursor = new Set();
    const cookie = String(params.webCookie || env.XUEQIU_WEB_COOKIE || '').trim();
    const collectRows = async (fetchPage) => {
      for (let page = 0; page < XUEQIU_MAX_PAGES; page += 1) {
        if (deduped.size >= limit) break;

        const payload = await fetchPage({
          maxId,
          sinceId,
          count: Math.min(XUEQIU_MAX_PAGE_SIZE, Math.max(10, limit - deduped.size)),
        });
        const rows = pickRows(payload);
        if (!rows.length) break;

        let reachedWindowStart = false;
        for (const row of rows) {
          const normalized = this.normalizeItem({
            ...row,
            providerCategoryKey: categoryKey,
          });
          const publishedTs = toTimestamp(normalized.publishedAt);
          if (publishedTs && publishedTs < startTs) {
            reachedWindowStart = true;
            continue;
          }
          if (publishedTs && publishedTs > endTs) continue;
          if (!normalized.providerItemId) continue;
          if (!deduped.has(normalized.providerItemId)) {
            deduped.set(normalized.providerItemId, normalized);
          }
          if (deduped.size >= limit) break;
        }

        if (reachedWindowStart) break;
        const nextMaxId = pickNextMaxId(payload, rows, maxId);
        if (nextMaxId === null || nextMaxId === maxId) break;

        const cursorKey = String(nextMaxId);
        if (seenCursor.has(cursorKey)) break;
        seenCursor.add(cursorKey);
        maxId = nextMaxId;
        sinceId = -1;
      }
      return Array.from(deduped.values()).slice(0, limit);
    };

    try {
      return await collectRows((pageParams) => callXueqiuLiveNews({
        ...pageParams,
        cookie,
      }));
    } catch (directError) {
      if (!isBrowserFallbackEnabled()) {
        throw directError;
      }

      try {
        return await this.pullItemsWithBrowser({
          categoryKey,
          limit,
          cookie,
          collectRows,
        });
      } catch (browserError) {
        throw new HttpError(
          502,
          `雪球资讯采集失败，直连错误: ${directError?.message || 'unknown error'}；浏览器回退错误: ${browserError?.message || 'unknown error'}`,
        );
      }
    }
  }

  async pullItemsWithBrowser(params = {}) {
    const session = await createXueqiuBrowserSession({
      cookie: params.cookie,
    });
    try {
      await session.page.goto(String(env.XUEQIU_BASE_URL || 'https://xueqiu.com').trim(), {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      const rows = await params.collectRows(async (pageParams) => {
        const payload = await session.page.evaluate(async (requestParams) => {
          const query = new URLSearchParams();
          query.set('max_id', String(requestParams.maxId ?? -1));
          query.set('since_id', String(requestParams.sinceId ?? -1));
          query.set('count', String(requestParams.count ?? 20));
          const response = await fetch(`/statuses/livenews/list.json?${query.toString()}`, {
            credentials: 'include',
            headers: {
              Accept: 'application/json, text/plain, */*',
              'X-Requested-With': 'XMLHttpRequest',
            },
          });
          const text = await response.text();
          return {
            ok: response.ok,
            status: response.status,
            text,
          };
        }, pageParams);

        if (!payload?.ok) {
          throw new HttpError(
            502,
            `雪球浏览器接口请求失败: HTTP ${payload?.status || '-'}${payload?.text ? `, ${String(payload.text).slice(0, 120)}` : ''}`,
          );
        }
        const json = JSON.parse(String(payload.text || '{}'));
        return json;
      });

      return rows;
    } finally {
      await session.close();
    }
  }

  normalizeItem(sourceItem = {}) {
    const content = stripHtml(
      sourceItem.text
      || sourceItem.content
      || sourceItem.description
      || sourceItem.reason
      || '',
    );
    const title = stripHtml(sourceItem.title || '') || toNewsTitle(content);
    const summary = stripHtml(sourceItem.summary || '') || content.slice(0, 280);
    const publishedAtRaw = (
      sourceItem.created_at
      || sourceItem.createdAt
      || sourceItem.published_at
      || sourceItem.time
      || sourceItem.datetime
    );
    const publishedAt = normalizeSourceDateTime(publishedAtRaw);
    const providerItemIdRaw = sourceItem.id || sourceItem.news_id || sourceItem.uid;
    const providerItemId = String(
      providerItemIdRaw
      || `xueqiu_7x24:${toHash(`${title}|${publishedAt || publishedAtRaw || ''}|${content}`)}`,
    ).trim();

    const author = String(
      sourceItem.author
      || sourceItem.username
      || sourceItem.user?.screen_name
      || '',
    ).trim() || null;

    return {
      provider: this.getKey(),
      providerItemId,
      providerCategoryKey: String(sourceItem.providerCategoryKey || 'xueqiu_7x24').trim(),
      title: title || '无标题',
      summary: summary || null,
      content: content || summary || '',
      url: String(sourceItem.target || sourceItem.url || sourceItem.link || '').trim() || null,
      sourceName: String(sourceItem.source || sourceItem.channel || '雪球7x24').trim(),
      author,
      publishedAt: publishedAt || null,
      lang: 'zh-CN',
      region: 'CN',
      tags: [],
      symbols: [],
      meta: sourceItem,
    };
  }
}

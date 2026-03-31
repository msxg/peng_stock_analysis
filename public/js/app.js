import { api } from './api.js';

const state = {
  tasks: [],
  history: [],
  selectedHistoryIds: new Set(),
  importItems: [],
  currentSessionId: null,
  activeAccountId: null,
  latestAnalysis: null,
  commandCursor: 0,
  commandItems: [],
  futuresCategories: [],
  futuresTimeframes: [],
  futuresPresets: [],
  futuresMonitor: null,
  futuresCategoryEditingId: null,
  futuresAutoRefreshMs: 30000,
  futuresAutoRefreshTimer: null,
  futuresMonitorLoading: false,
  futuresLastTabRefreshAt: 0,
  futuresKlinePreset: 'minute',
  futuresMinuteTimeframeKey: '1m',
  stockBasics: [],
  stockBasicsTotal: 0,
  stockBasicsPage: 1,
  stockBasicsLimit: 80,
  stockMonitorCategories: [],
  stockMonitorTimeframes: [],
  stockMonitor: null,
  stockCategoryEditingId: null,
  stockAutoRefreshMs: 30000,
  stockAutoRefreshTimer: null,
  stockMonitorLoading: false,
  stockLastTabRefreshAt: 0,
  stockKlinePreset: 'minute',
  stockMinuteTimeframeKey: '1m',
};

const chartStore = {
  price: null,
  volume: null,
  chip: null,
};

const FUTURES_PRESET_SYMBOLS_FALLBACK = [
  { exchange: 'COMEX', name: '黄金主连', quoteCode: '101.GC00Y' },
  { exchange: 'COMEX', name: '白银主连', quoteCode: '101.SI00Y' },
  { exchange: 'COMEX', name: '铜主连', quoteCode: '101.HG00Y' },
  { exchange: 'NYMEX', name: '原油主连', quoteCode: '102.CL00Y' },
  { exchange: 'NYMEX', name: '天然气主连', quoteCode: '102.NG00Y' },
  { exchange: 'NYMEX', name: '汽油主连', quoteCode: '102.RB00Y' },
  { exchange: 'NYMEX', name: '燃油主连', quoteCode: '102.HO00Y' },
  { exchange: 'IPE', name: '布伦特原油主连', quoteCode: '112.B00Y' },
  { exchange: '上期所(示例)', name: '沪金2606', quoteCode: '113.au2606' },
  { exchange: '上期所(示例)', name: '沪银2606', quoteCode: '113.ag2606' },
  { exchange: '上期能源(示例)', name: '原油2605', quoteCode: '142.sc2605' },
];

const FUTURES_KLINE_PRESET_ITEMS = [
  { key: 'minute', label: '分钟' },
  { key: 'day', label: '日K' },
  { key: 'week', label: '周K' },
  { key: 'month', label: '月K' },
];

const FUTURES_INTRADAY_KEYS = ['1m', '5m', '15m', '30m', '60m', '30s'];
const FUTURES_LONG_KLINE_KEYS = ['1d', '1w', '1M'];
const FUTURES_LONG_KLINE_LIMIT = 100;
const STOCK_LONG_KLINE_LIMIT = 100;

const $ = (id) => document.getElementById(id);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeNum(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return n.toFixed(digits);
}

function signedPct(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const text = n.toFixed(digits);
  return `${n > 0 ? '+' : ''}${text}%`;
}

function signedNum(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const text = n.toFixed(digits);
  return `${n > 0 ? '+' : ''}${text}`;
}

function compactNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  if (Math.abs(n) >= 100000000) return `${(n / 100000000).toFixed(2)}亿`;
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(2)}万`;
  return Math.round(n).toLocaleString();
}

function formatFuturesDisplayName(nameOrCode = '') {
  return String(nameOrCode || '')
    .replace(/[\(（]\s*自动匹配当前合约\s*[\)）]/g, '')
    .trim();
}

function safeLocalStorageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function formatDateTime(value) {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);

  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  const ss = String(dt.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function formatTimeAxisLabel(value = '') {
  const text = String(value || '').trim();
  if (!text) return '-';

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text.slice(5);
  }
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(text)) {
    return text.slice(11, 16);
  }
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(text)) {
    return text.slice(11, 16);
  }
  return text;
}

function parseCandleDateToMs(value = '') {
  const text = String(value || '').trim();
  if (!text) return Number.NaN;

  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, y, m, d] = match;
    return new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0).getTime();
  }

  match = text.match(/^(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    const [, y, m, d, hh, mm, ss] = match;
    return new Date(
      Number(y),
      Number(m) - 1,
      Number(d),
      Number(hh),
      Number(mm),
      Number(ss || 0),
      0,
    ).getTime();
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function isIntradayFuturesFrame(timeframe = '') {
  return ['30s', '1m', '5m', '15m', '30m', '60m'].includes(String(timeframe || ''));
}

function isFuturesLongKlineFrame(timeframe = '') {
  return FUTURES_LONG_KLINE_KEYS.includes(String(timeframe || ''));
}

function resolveFuturesMonitorLimit(timeframe = '') {
  return isFuturesLongKlineFrame(timeframe) ? FUTURES_LONG_KLINE_LIMIT : 120;
}

function calcMovingAverage(values = [], period = 5) {
  const source = Array.isArray(values) ? values : [];
  const size = Number(period);
  if (!Number.isFinite(size) || size <= 1) {
    return source.map((value) => Number(value));
  }

  const result = new Array(source.length).fill(Number.NaN);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < source.length; i += 1) {
    const current = Number(source[i]);
    if (Number.isFinite(current)) {
      sum += current;
      count += 1;
    }

    if (i >= size) {
      const drop = Number(source[i - size]);
      if (Number.isFinite(drop)) {
        sum -= drop;
        count -= 1;
      }
    }

    if (i >= size - 1 && count === size) {
      result[i] = sum / size;
    }
  }
  return result;
}

function inferFuturesKlinePreset(timeframe = '') {
  const key = String(timeframe || '');
  if (key === '1d') return 'day';
  if (key === '1w') return 'week';
  if (key === '1M') return 'month';
  return 'minute';
}

function resolveMinuteTimeframeKey() {
  const frames = state.futuresTimeframes || [];
  const available = new Set(frames.map((item) => item.key));
  if (available.has(state.futuresMinuteTimeframeKey)) return state.futuresMinuteTimeframeKey;
  const preferred = FUTURES_INTRADAY_KEYS.find((key) => available.has(key));
  return preferred || '1m';
}

function resolveFuturesTimeframeByPreset(preset = 'minute') {
  const frames = state.futuresTimeframes || [];
  const available = new Set(frames.map((item) => item.key));

  if (preset === 'day') {
    if (available.has('1d')) return '1d';
    return resolveMinuteTimeframeKey();
  }
  if (preset === 'week') {
    if (available.has('1w')) return '1w';
    if (available.has('1d')) return '1d';
    return resolveMinuteTimeframeKey();
  }
  if (preset === 'month') {
    if (available.has('1M')) return '1M';
    if (available.has('1w')) return '1w';
    if (available.has('1d')) return '1d';
    return resolveMinuteTimeframeKey();
  }
  return resolveMinuteTimeframeKey();
}

function syncFuturesKlineStateByTimeframe(timeframe = '') {
  const tf = String(timeframe || '');
  const preset = inferFuturesKlinePreset(tf);
  state.futuresKlinePreset = preset;
  if (preset === 'minute' && tf) {
    state.futuresMinuteTimeframeKey = tf;
  }
}

function inferStockKlinePreset(timeframe = '') {
  const key = String(timeframe || '');
  if (key === '1d') return 'day';
  if (key === '1w') return 'week';
  if (key === '1M') return 'month';
  return 'minute';
}

function resolveStockMinuteTimeframeKey() {
  const frames = state.stockMonitorTimeframes || [];
  const available = new Set(frames.map((item) => item.key));
  if (available.has(state.stockMinuteTimeframeKey)) return state.stockMinuteTimeframeKey;
  if (available.has('1m')) return '1m';
  return (frames[0]?.key || '1m');
}

function resolveStockTimeframeByPreset(preset = 'minute') {
  const frames = state.stockMonitorTimeframes || [];
  const available = new Set(frames.map((item) => item.key));

  if (preset === 'day') {
    if (available.has('1d')) return '1d';
    return resolveStockMinuteTimeframeKey();
  }
  if (preset === 'week') {
    if (available.has('1w')) return '1w';
    if (available.has('1d')) return '1d';
    return resolveStockMinuteTimeframeKey();
  }
  if (preset === 'month') {
    if (available.has('1M')) return '1M';
    if (available.has('1w')) return '1w';
    if (available.has('1d')) return '1d';
    return resolveStockMinuteTimeframeKey();
  }
  return resolveStockMinuteTimeframeKey();
}

function syncStockKlineStateByTimeframe(timeframe = '') {
  const tf = String(timeframe || '');
  const preset = inferStockKlinePreset(tf);
  state.stockKlinePreset = preset;
  if (preset === 'minute' && tf) {
    state.stockMinuteTimeframeKey = tf;
  }
}

function getFuturesXAxis(candles = [], timeframe = '', area = { x: 0, w: 1 }) {
  const count = candles.length;
  const pointByIndex = (idx) => area.x + (idx / Math.max(count - 1, 1)) * area.w;
  const labelIndexes = Array.from(new Set([
    0,
    Math.floor((count - 1) * 0.33),
    Math.floor((count - 1) * 0.66),
    count - 1,
  ])).filter((idx) => idx >= 0 && idx < count);

  const fallback = {
    pointXByIndex: pointByIndex,
    tickLabels: labelIndexes.map((idx) => ({
      x: pointByIndex(idx),
      label: formatTimeAxisLabel(candles[idx]?.date),
    })),
  };

  if (!count || !isIntradayFuturesFrame(timeframe)) {
    return fallback;
  }

  const tsList = candles.map((item) => parseCandleDateToMs(item?.date));
  const firstTs = tsList.find((ts) => Number.isFinite(ts));
  if (!Number.isFinite(firstTs)) {
    return fallback;
  }

  const lastTs = [...tsList].reverse().find((ts) => Number.isFinite(ts));
  const startMs = firstTs;
  const nowMs = Date.now();
  const latestMs = Number.isFinite(lastTs) ? lastTs : startMs;

  const realtimeToleranceMsMap = {
    '30s': 2 * 60 * 1000,
    '1m': 3 * 60 * 1000,
    '5m': 15 * 60 * 1000,
    '15m': 45 * 60 * 1000,
    '30m': 90 * 60 * 1000,
    '60m': 180 * 60 * 1000,
  };
  const toleranceMs = realtimeToleranceMsMap[String(timeframe || '')] || (5 * 60 * 1000);
  const useNowAsEnd = nowMs >= latestMs && (nowMs - latestMs) <= toleranceMs;
  const endMsRaw = useNowAsEnd ? nowMs : latestMs;
  const endMs = endMsRaw > startMs ? endMsRaw : (startMs + 60 * 1000);
  const crossDay = new Date(startMs).toDateString() !== new Date(endMs).toDateString();

  const pointXByIndex = (idx) => {
    const ts = tsList[idx];
    if (!Number.isFinite(ts)) return pointByIndex(idx);
    const ratio = Math.max(0, Math.min(1, (ts - startMs) / (endMs - startMs)));
    return area.x + ratio * area.w;
  };

  const toClock = (ts) => {
    const d = new Date(ts);
    const mmdd = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return crossDay ? `${mmdd} ${hh}:${mm}` : `${hh}:${mm}`;
  };

  const tickTimes = [startMs, startMs + (endMs - startMs) / 3, startMs + ((endMs - startMs) * 2) / 3, endMs];

  return {
    pointXByIndex,
    tickLabels: tickTimes.map((ts) => ({
      x: area.x + Math.max(0, Math.min(1, (ts - startMs) / (endMs - startMs || 1))) * area.w,
      label: toClock(ts),
    })),
  };
}

function normalizeFuturesQuoteForUi(quote = {}) {
  const price = Number(quote?.price);
  const change = Number(quote?.change);
  let prevClose = Number(quote?.prevClose);
  const derivedPrevClose = (
    Number.isFinite(price)
    && Number.isFinite(change)
  ) ? (price - change) : Number.NaN;

  const priceOk = Number.isFinite(price);
  const changeOk = Number.isFinite(change);
  if (Number.isFinite(derivedPrevClose)) {
    const inconsistent = (
      Number.isFinite(prevClose)
      && Math.abs(prevClose - derivedPrevClose) > Math.max(Math.abs(derivedPrevClose) * 0.001, 0.01)
    );
    if (!Number.isFinite(prevClose) || inconsistent) {
      prevClose = derivedPrevClose;
    }
  }

  let changePct = Number(quote?.changePct);
  if (changeOk && Number.isFinite(prevClose) && prevClose !== 0) {
    changePct = (change / prevClose) * 100;
  } else if (!Number.isFinite(changePct)) {
    changePct = null;
  }

  return {
    ...quote,
    price: priceOk ? price : null,
    change: changeOk ? change : null,
    prevClose: Number.isFinite(prevClose) ? prevClose : null,
    changePct: Number.isFinite(changePct) ? changePct : null,
  };
}

function normalizeStockQuoteForUi(quote = {}) {
  const price = Number(quote?.price);
  let prevClose = Number(quote?.prevClose);
  let change = Number(quote?.change);

  if (!Number.isFinite(change) && Number.isFinite(price) && Number.isFinite(prevClose)) {
    change = price - prevClose;
  }
  if (!Number.isFinite(prevClose) && Number.isFinite(price) && Number.isFinite(change)) {
    prevClose = price - change;
  }

  let changePct = Number(quote?.changePct);
  if (Number.isFinite(change) && Number.isFinite(prevClose) && prevClose !== 0) {
    changePct = (change / prevClose) * 100;
  }

  return {
    ...quote,
    price: Number.isFinite(price) ? price : null,
    prevClose: Number.isFinite(prevClose) ? prevClose : null,
    change: Number.isFinite(change) ? change : null,
    changePct: Number.isFinite(changePct) ? changePct : null,
  };
}

function valueClassByNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'value-neutral';
  if (n > 0) return 'value-up';
  if (n < 0) return 'value-down';
  return 'value-neutral';
}

function cnMarketClassByNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'value-neutral';
  if (n > 0) return 'cn-value-up';
  if (n < 0) return 'cn-value-down';
  return 'value-neutral';
}

function confidenceBadge(level = 'low') {
  if (level === 'high') return '<span class="conf-high">高</span>';
  if (level === 'medium') return '<span class="conf-medium">中</span>';
  return '<span class="conf-low">低</span>';
}

function statusBadge(status) {
  const text = String(status || '').toLowerCase();
  if (text === 'completed') return '<span class="conf-high">已完成</span>';
  if (text === 'running') return '<span class="conf-medium">执行中</span>';
  if (text === 'failed') return '<span class="conf-low">失败</span>';
  return '<span class="tag">排队中</span>';
}

function showBanner(id, message, isError = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  el.style.borderColor = isError ? '#fecdd3' : '#d5ddff';
  el.style.background = isError ? '#fff1f2' : '#f5f7ff';
  el.style.color = isError ? '#be123c' : '#3f5482';
}

function clearBanner(id) {
  const el = $(id);
  if (!el) return;
  el.classList.add('hidden');
}

function setText(id, value) {
  const el = $(id);
  if (!el) return;
  el.textContent = value;
}

function setHtml(id, html) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = html;
}

function setValue(id, value) {
  const el = $(id);
  if (!el) return;
  el.value = value;
}

function setButtonLoading(btnId, loading, loadingText = '处理中...') {
  const btn = $(btnId);
  if (!btn) return;

  if (loading) {
    btn.dataset.originText = btn.textContent;
    btn.textContent = loadingText;
    btn.disabled = true;
    btn.classList.add('is-loading');
    return;
  }

  btn.textContent = btn.dataset.originText || btn.textContent;
  btn.disabled = false;
  btn.classList.remove('is-loading');
}

function showGlobalLoading(text = '正在处理...') {
  const mask = $('globalLoading');
  const label = $('globalLoadingText');
  if (!mask || !label) return;
  label.textContent = text;
  mask.classList.remove('hidden');
}

function hideGlobalLoading() {
  $('globalLoading')?.classList.add('hidden');
}

async function withLoading(btnId, loadingText, fn, { global = false, globalText = '正在处理...' } = {}) {
  try {
    setButtonLoading(btnId, true, loadingText);
    if (global) showGlobalLoading(globalText);
    return await fn();
  } finally {
    setButtonLoading(btnId, false);
    if (global) hideGlobalLoading();
  }
}

function normalizeAnalysisPayload(record) {
  if (!record) return null;
  const technical = record.technical || {};
  const ext = technical.extended || {};
  return {
    ...record,
    technical,
    sentiment: record.sentiment || ext.sentiment || null,
    strategy: record.strategy || ext.strategy || null,
    market_review: record.market_review || ext.market_review || null,
    dashboard: record.dashboard || ext.dashboard || null,
    fundamental_context: record.fundamental_context || ext.fundamental_context || null,
    newsMeta: record.newsMeta || ext.newsMeta || null,
  };
}

function activateTab(tabId) {
  const allButtons = $$('#mainNav button[data-tab]');
  allButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabId));
  $$('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `tab-${tabId}`));

  if (tabId === 'futures') {
    onFuturesTabActivated();
    return;
  }
  if (tabId === 'stock-monitor') {
    onStockMonitorTabActivated();
    return;
  }
  if (tabId === 'base-data') {
    onBaseDataTabActivated();
  }
}

function onFuturesTabActivated() {
  // 期货面板从隐藏变为可见后，先用现有数据重绘，避免隐藏态canvas宽度异常。
  if (state.futuresMonitor) {
    renderFuturesMonitor(state.futuresMonitor);
  }

  // 进入页面时立即刷新一次实时数据，不等待自动刷新周期。
  const now = Date.now();
  if (now - Number(state.futuresLastTabRefreshAt || 0) < 1500) {
    return;
  }
  state.futuresLastTabRefreshAt = now;

  withLoading('refreshFuturesMonitorBtn', '刷新中...', () => loadFuturesMonitor({ silent: true }))
    .catch((error) => {
      showBanner('futuresMsg', `进入期货页面刷新失败: ${error.message}`, true);
    });
}

function onStockMonitorTabActivated() {
  if (state.stockMonitor) {
    renderStockMonitor(state.stockMonitor);
  }

  const now = Date.now();
  if (now - Number(state.stockLastTabRefreshAt || 0) < 1500) {
    return;
  }
  state.stockLastTabRefreshAt = now;

  withLoading('refreshStockMonitorBtn', '刷新中...', () => loadStockMonitor({ silent: true }))
    .catch((error) => {
      showBanner('stockMsg', `进入股票监测页面刷新失败: ${error.message}`, true);
    });
}

function onBaseDataTabActivated() {
  if (state.stockBasics?.length) return;
  withLoading('searchStockBasicsBtn', '检索中...', () => searchStockBasics({ silent: true }))
    .catch((error) => {
      showBanner('stockBasicsMsg', `加载基础数据失败: ${error.message}`, true);
    });
}

function setupTabs() {
  $$('#mainNav button[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });
}

function setupSidebarGroups() {
  $$('#mainNav .group-toggle').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const group = toggle.closest('.nav-group');
      group?.classList.toggle('collapsed');
    });
  });
}

function parseCodeFromText(text) {
  const match = String(text || '').match(/(hk\d{5}|\d{5,6}|[A-Za-z]{2,8})/);
  return match ? match[1].toUpperCase() : null;
}

function summarizeValue(value, depth = 0) {
  if (value == null) return '-';
  if (typeof value === 'number') return safeNum(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return value || '-';

  if (Array.isArray(value)) {
    if (!value.length) return '0 条';
    if (typeof value[0] === 'object') {
      const sample = Object.keys(value[0] || {}).slice(0, 3).join('/');
      return `${value.length} 条${sample ? `（字段: ${sample}）` : ''}`;
    }
    return value.slice(0, 4).join(', ') + (value.length > 4 ? ' ...' : '');
  }

  if (typeof value === 'object') {
    if (depth > 0) return `${Object.keys(value).length} 项`;
    const parts = Object.entries(value)
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${summarizeValue(v, depth + 1)}`);
    return parts.join(' | ');
  }

  return String(value);
}

function getCommandActions() {
  return [
    { key: '打开实时仪表盘', hint: '切换页面', run: () => activateTab('realtime') },
    { key: '打开市场复盘', hint: '切换页面', run: () => activateTab('market') },
    { key: '打开期货监测', hint: '切换页面', run: () => activateTab('futures') },
    { key: '打开股票监测', hint: '切换页面', run: () => activateTab('stock-monitor') },
    { key: '打开智能导入', hint: '切换页面', run: () => activateTab('import') },
    { key: '打开历史与回测', hint: '切换页面', run: () => activateTab('history') },
    { key: '打开问股Agent', hint: '切换页面', run: () => activateTab('agent') },
    { key: '打开持仓管理', hint: '切换页面', run: () => activateTab('portfolio') },
    { key: '打开基础数据', hint: '切换页面', run: () => activateTab('base-data') },
    { key: '打开系统设置', hint: '切换页面', run: () => activateTab('system') },
    { key: '刷新任务列表', hint: '分析模块', run: () => loadTasks() },
    { key: '刷新市场快照', hint: '分析模块', run: () => loadQuickMarket() },
    { key: '刷新大盘复盘', hint: '市场模块', run: () => loadMarketReview() },
    { key: '刷新期货监测', hint: '期货模块', run: () => loadFuturesMonitor() },
    { key: '刷新股票监测', hint: '行情中心', run: () => loadStockMonitor() },
    { key: '刷新股票基础数据', hint: '基础数据', run: () => searchStockBasics() },
    { key: '刷新历史记录', hint: '历史模块', run: () => loadHistory() },
    { key: '刷新回测结果', hint: '回测模块', run: () => refreshBacktest() },
  ];
}

function openCommandPalette(initialText = '') {
  const panel = $('commandPalette');
  const input = $('commandPaletteInput');
  if (!panel || !input) return;
  panel.classList.remove('hidden');
  input.value = initialText;
  renderCommandList(initialText);
  input.focus();
}

function closeCommandPalette() {
  $('commandPalette')?.classList.add('hidden');
}

function openFuturesCategoryModal() {
  resetFuturesCategoryForm();
  renderFuturesCategoryList();
  $('futuresCategoryModal')?.classList.remove('hidden');
  $('futuresCategoryNameInput')?.focus();
}

function closeFuturesCategoryModal() {
  $('futuresCategoryModal')?.classList.add('hidden');
}

async function openFuturesSymbolModal() {
  if (!state.futuresCategories.length) {
    await loadFuturesCategories();
  }
  renderFuturesManageList();
  renderFuturesPresetSelect();
  $('futuresSymbolModal')?.classList.remove('hidden');
  $('futuresSymbolCodeInput')?.focus();
}

function closeFuturesSymbolModal() {
  $('futuresSymbolModal')?.classList.add('hidden');
}

function openFuturesConsoleModal() {
  $('futuresConsoleModal')?.classList.remove('hidden');
}

function closeFuturesConsoleModal() {
  $('futuresConsoleModal')?.classList.add('hidden');
}

function openStockCategoryModal() {
  resetStockCategoryForm();
  renderStockCategoryList();
  $('stockCategoryModal')?.classList.remove('hidden');
  $('stockCategoryNameInput')?.focus();
}

function closeStockCategoryModal() {
  $('stockCategoryModal')?.classList.add('hidden');
}

async function openStockSymbolModal() {
  if (!state.stockMonitorCategories.length) {
    await loadStockMonitorCategories();
  }
  if (!state.stockBasics.length) {
    await searchStockBasics({ silent: true });
  }
  renderStockCategorySelect();
  renderStockBasicsQuickSelect();
  renderStockManageList();
  $('stockSymbolModal')?.classList.remove('hidden');
  $('stockSymbolCodeInput')?.focus();
}

function closeStockSymbolModal() {
  $('stockSymbolModal')?.classList.add('hidden');
}

function openStockConsoleModal() {
  $('stockConsoleModal')?.classList.remove('hidden');
}

function closeStockConsoleModal() {
  $('stockConsoleModal')?.classList.add('hidden');
}

function renderCommandList(keyword = '') {
  const listEl = $('commandList');
  if (!listEl) return;

  const actions = getCommandActions();
  const text = String(keyword || '').trim().toLowerCase();
  const dynamicCode = parseCodeFromText(keyword);

  let items = actions.filter((item) => item.key.toLowerCase().includes(text));

  if (dynamicCode) {
    items = [
      {
        key: `分析 ${dynamicCode}`,
        hint: '立即发起单股分析',
        run: async () => {
          setValue('singleCodeInput', dynamicCode);
          await withLoading('runSingleBtn', '分析中...', () => runSingleAnalysis(dynamicCode), {
            global: true,
            globalText: '正在分析股票，请稍候...',
          });
        },
      },
      ...items,
    ];
  }

  if (!items.length) {
    listEl.innerHTML = '<div class="command-item"><span>无匹配命令</span><small>试试：打开市场复盘 / 分析 AAPL</small></div>';
    state.commandItems = [];
    state.commandCursor = 0;
    return;
  }

  state.commandItems = items;
  state.commandCursor = 0;

  listEl.innerHTML = items
    .map((item, idx) => `
      <button class="command-item ${idx === 0 ? 'active' : ''}" data-command-index="${idx}">
        <span>${escapeHtml(item.key)}</span>
        <small>${escapeHtml(item.hint || '')}</small>
      </button>
    `)
    .join('');

  $$('[data-command-index]', listEl).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.dataset.commandIndex);
      await executeCommandAt(idx);
    });
  });
}

function updateCommandCursor(next) {
  if (!state.commandItems.length) return;
  state.commandCursor = Math.max(0, Math.min(state.commandItems.length - 1, next));
  const rows = $$('[data-command-index]', $('commandList'));
  rows.forEach((row, idx) => row.classList.toggle('active', idx === state.commandCursor));
}

async function executeCommandAt(index) {
  const item = state.commandItems[index];
  if (!item) return;
  closeCommandPalette();
  await item.run();
}

async function runQuickCommand(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return false;

  const normalized = text.toLowerCase();
  const code = parseCodeFromText(text);
  const wantsAnalyze = /(分析|analyze|analysis|run)/.test(normalized);

  if (code && wantsAnalyze) {
    setValue('singleCodeInput', code);
    await withLoading('runSingleBtn', '分析中...', () => runSingleAnalysis(code), {
      global: true,
      globalText: '正在分析股票，请稍候...',
    });
    return true;
  }

  const actions = getCommandActions();
  const direct = actions.find((item) => {
    const key = item.key.toLowerCase();
    return key === normalized || key.includes(normalized) || normalized.includes(key.replace('打开', ''));
  });

  if (direct) {
    await direct.run();
    return true;
  }

  if (code) {
    setValue('singleCodeInput', code);
    await withLoading('runSingleBtn', '分析中...', () => runSingleAnalysis(code), {
      global: true,
      globalText: '正在分析股票，请稍候...',
    });
    return true;
  }

  return false;
}

function setupCommandPalette() {
  $('commandOpenBtn')?.addEventListener('click', () => openCommandPalette(''));

  $('commandInput')?.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const text = event.currentTarget.value;
      const handled = await runQuickCommand(text);
      if (!handled) openCommandPalette(text);
    }
  });

  const panelInput = $('commandPaletteInput');
  panelInput?.addEventListener('input', (event) => renderCommandList(event.currentTarget.value));
  panelInput?.addEventListener('keydown', async (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      updateCommandCursor(state.commandCursor + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      updateCommandCursor(state.commandCursor - 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      await executeCommandAt(state.commandCursor);
      return;
    }
    if (event.key === 'Escape') {
      closeCommandPalette();
    }
  });

  $('commandPalette')?.addEventListener('click', (event) => {
    if (event.target.id === 'commandPalette') closeCommandPalette();
  });

  window.addEventListener('keydown', (event) => {
    const isCmdK = (event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 'k';
    if (isCmdK) {
      event.preventDefault();
      openCommandPalette(($('commandInput')?.value || '').trim());
      return;
    }

    if (event.key === 'Escape') {
      closeCommandPalette();
      closeFuturesCategoryModal();
      closeFuturesSymbolModal();
      closeFuturesConsoleModal();
      closeStockCategoryModal();
      closeStockSymbolModal();
      closeStockConsoleModal();
    }
  });
}

function drawCanvas(canvas, renderFn) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(280, Math.floor(rect.width));
  const height = Number(canvas.getAttribute('height')) || 260;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  renderFn(ctx, width, height);
}

function drawGrid(ctx, { x, y, w, h }, rows = 4, cols = 6) {
  ctx.strokeStyle = 'rgba(140, 160, 198, 0.18)';
  ctx.lineWidth = 1;

  for (let i = 0; i <= rows; i += 1) {
    const gy = y + (h / rows) * i;
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x + w, gy);
    ctx.stroke();
  }

  for (let i = 0; i <= cols; i += 1) {
    const gx = x + (w / cols) * i;
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + h);
    ctx.stroke();
  }
}

function renderPriceChart(candles = []) {
  const canvas = $('priceChart');
  drawCanvas(canvas, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    if (!candles.length) {
      ctx.fillStyle = '#7d8cab';
      ctx.fillText('暂无数据', 14, 20);
      chartStore.price = null;
      return;
    }

    const pad = { left: 44, right: 12, top: 18, bottom: 24 };
    const area = { x: pad.left, y: pad.top, w: w - pad.left - pad.right, h: h - pad.top - pad.bottom };

    const closes = candles.map((item) => Number(item.close || 0));
    const ma5 = candles.map((item) => Number(item.ma5 || NaN));
    const ma10 = candles.map((item) => Number(item.ma10 || NaN));
    const ma20 = candles.map((item) => Number(item.ma20 || NaN));

    const all = closes
      .concat(ma5.filter(Number.isFinite), ma10.filter(Number.isFinite), ma20.filter(Number.isFinite))
      .filter((num) => Number.isFinite(num) && num > 0);

    const min = Math.min(...all);
    const max = Math.max(...all);
    const span = Math.max(0.01, max - min);

    const xAt = (idx) => area.x + (idx / Math.max(1, candles.length - 1)) * area.w;
    const yAt = (value) => area.y + ((max - value) / span) * area.h;

    drawGrid(ctx, area, 4, 6);
    ctx.fillStyle = '#7d8cab';
    ctx.font = '11px IBM Plex Mono';
    for (let i = 0; i <= 4; i += 1) {
      const v = max - (span / 4) * i;
      const yTick = area.y + (area.h / 4) * i;
      ctx.fillText(v.toFixed(2), 4, yTick + 4);
    }

    const points = closes.map((value, idx) => ({
      x: xAt(idx),
      y: yAt(value),
      close: value,
      ma5: ma5[idx],
      ma10: ma10[idx],
      ma20: ma20[idx],
      date: candles[idx]?.date,
    }));

    const gradient = ctx.createLinearGradient(0, area.y, 0, area.y + area.h);
    gradient.addColorStop(0, 'rgba(70, 95, 255, 0.28)');
    gradient.addColorStop(1, 'rgba(70, 95, 255, 0.02)');

    ctx.beginPath();
    points.forEach((pt, idx) => {
      if (idx === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.lineTo(points[points.length - 1].x, area.y + area.h);
    ctx.lineTo(points[0].x, area.y + area.h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    points.forEach((pt, idx) => {
      if (idx === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#465fff';
    ctx.stroke();

    const drawLine = (arr, color) => {
      const valid = arr
        .map((value, idx) => (Number.isFinite(value) ? { x: xAt(idx), y: yAt(value) } : null))
        .filter(Boolean);
      if (valid.length < 2) return;
      ctx.beginPath();
      valid.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = color;
      ctx.stroke();
    };

    drawLine(ma5, '#d97706');
    drawLine(ma10, '#16a34a');
    drawLine(ma20, '#dc2626');

    ctx.fillStyle = '#7d8cab';
    ctx.font = '11px IBM Plex Mono';
    ctx.fillText(`MAX ${max.toFixed(2)}`, 8, 12);
    ctx.fillText(`MIN ${min.toFixed(2)}`, 8, h - 8);
    ctx.fillText(candles[0]?.date || '-', area.x, h - 8);
    ctx.fillText(candles[candles.length - 1]?.date || '-', area.x + area.w - 88, h - 8);

    chartStore.price = {
      type: 'line',
      points,
      format(point) {
        return [
          `<strong>${point.date || '-'}</strong>`,
          `收盘：${safeNum(point.close)}`,
          `MA5：${safeNum(point.ma5)}`,
          `MA10：${safeNum(point.ma10)}`,
          `MA20：${safeNum(point.ma20)}`,
        ].join('<br/>');
      },
    };
  });
}

function renderVolumeChart(candles = []) {
  const canvas = $('volumeChart');
  drawCanvas(canvas, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    if (!candles.length) {
      ctx.fillStyle = '#7d8cab';
      ctx.fillText('暂无数据', 14, 20);
      chartStore.volume = null;
      return;
    }

    const pad = { left: 36, right: 12, top: 18, bottom: 24 };
    const area = { x: pad.left, y: pad.top, w: w - pad.left - pad.right, h: h - pad.top - pad.bottom };
    drawGrid(ctx, area, 4, 6);

    const volumes = candles.map((item) => Number(item.volume || 0));
    const max = Math.max(...volumes, 1);
    const barWidth = Math.max(3, area.w / volumes.length - 1.2);

    const entries = volumes.map((volume, idx) => {
      const x = area.x + (idx / volumes.length) * area.w;
      const barH = (volume / max) * area.h;
      const y = area.y + area.h - barH;
      const rising = idx > 0 ? Number(candles[idx].close) >= Number(candles[idx - 1].close) : true;

      const color = rising ? 'rgba(220, 38, 38, 0.72)' : 'rgba(22, 163, 74, 0.72)';
      ctx.fillStyle = color;
      ctx.fillRect(x, y, barWidth, barH);

      return {
        cx: x + barWidth / 2,
        cy: y,
        volume,
        date: candles[idx]?.date,
        color,
      };
    });

    ctx.fillStyle = '#7d8cab';
    ctx.font = '11px IBM Plex Mono';
    ctx.fillText(`MAX ${Math.round(max)}`, 8, 12);
    for (let i = 0; i <= 4; i += 1) {
      const v = max - (max / 4) * i;
      const yTick = area.y + (area.h / 4) * i;
      ctx.fillText(Math.round(v).toLocaleString(), 4, yTick + 4);
    }

    chartStore.volume = {
      type: 'line',
      points: entries.map((item) => ({ x: item.cx, y: item.cy, ...item })),
      format(point) {
        return [
          `<strong>${point.date || '-'}</strong>`,
          `成交量：${Math.round(point.volume || 0).toLocaleString()}`,
        ].join('<br/>');
      },
    };
  });
}

function renderChipChart(profile = []) {
  const canvas = $('chipChart');
  drawCanvas(canvas, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    if (!profile.length) {
      ctx.fillStyle = '#7d8cab';
      ctx.fillText('暂无数据', 14, 20);
      chartStore.chip = null;
      return;
    }

    const pad = { left: 118, right: 20, top: 18, bottom: 18 };
    const area = { x: pad.left, y: pad.top, w: w - pad.left - pad.right, h: h - pad.top - pad.bottom };

    const max = Math.max(...profile.map((item) => Number(item.ratio || 0)), 1);
    const rowHeight = Math.max(18, area.h / profile.length);

    const entries = profile.map((item, idx) => {
      const ratio = Number(item.ratio || 0);
      const barW = (ratio / max) * area.w;
      const y = area.y + idx * rowHeight;

      const grad = ctx.createLinearGradient(area.x, y, area.x + barW, y);
      grad.addColorStop(0, '#5b74ff');
      grad.addColorStop(1, '#8ea0ff');
      ctx.fillStyle = grad;
      ctx.fillRect(area.x, y + 3, barW, rowHeight - 6);

      ctx.fillStyle = '#7d8cab';
      ctx.font = '11px IBM Plex Mono';
      ctx.fillText(item.priceRange || '-', 8, y + rowHeight * 0.7);
      ctx.fillText(`${safeNum(ratio, 2)}%`, area.x + barW + 6, y + rowHeight * 0.7);

      return {
        x: area.x + barW,
        y: y + rowHeight / 2,
        ratio,
        priceRange: item.priceRange || '-',
      };
    });

    chartStore.chip = {
      type: 'list',
      points: entries,
      format(point) {
        return [
          `<strong>${point.priceRange}</strong>`,
          `筹码占比：${safeNum(point.ratio, 2)}%`,
        ].join('<br/>');
      },
    };
  });
}

function showChartTooltip(clientX, clientY, html) {
  const tip = $('chartTooltip');
  if (!tip) return;
  tip.innerHTML = html;
  tip.classList.remove('hidden');
  tip.style.left = `${clientX + 14}px`;
  tip.style.top = `${clientY + 14}px`;
}

function hideChartTooltip() {
  $('chartTooltip')?.classList.add('hidden');
}

function bindChartHover(canvasId, key) {
  const canvas = $(canvasId);
  if (!canvas) return;

  canvas.addEventListener('mousemove', (event) => {
    const store = chartStore[key];
    if (!store?.points?.length) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    let nearest = store.points[0];
    let minDist = Infinity;

    for (const point of store.points) {
      const dx = (point.x ?? point.cx ?? 0) - x;
      const dy = (point.y ?? point.cy ?? 0) - y;
      const dist = store.type === 'list' ? Math.abs(dy) : Math.abs(dx) + Math.abs(dy) * 0.25;
      if (dist < minDist) {
        minDist = dist;
        nearest = point;
      }
    }

    showChartTooltip(event.clientX, event.clientY, store.format(nearest));
  });

  canvas.addEventListener('mouseleave', hideChartTooltip);
}

function renderTaskList() {
  const root = $('taskList');
  if (!root) return;

  if (!state.tasks.length) {
    root.innerHTML = '<div class="muted">暂无任务</div>';
    return;
  }

  root.innerHTML = state.tasks
    .map((task) => `
      <div class="list-item">
        <strong>${escapeHtml(task.taskId.slice(0, 8))}... ${statusBadge(task.status)}</strong>
        <div class="small">股票：${escapeHtml((task.stockCodes || []).join(', ') || '-')}</div>
        ${task.error ? `<div class="small value-down">错误：${escapeHtml(task.error)}</div>` : ''}
      </div>
    `)
    .join('');
}

function renderSummaryCards(id, cards) {
  setHtml(
    id,
    (cards || [])
      .map((card) => `
        <div class="summary-card">
          <div class="label">${escapeHtml(card.label)}</div>
          <div class="value ${escapeHtml(card.className || 'value-neutral')}">${escapeHtml(card.value)}</div>
        </div>
      `)
      .join('') || '<div class="muted">暂无数据</div>',
  );
}

function applyMetricColor(id, value) {
  const el = $(id);
  if (!el) return;
  el.classList.remove('value-up', 'value-down', 'value-neutral');
  el.classList.add(valueClassByNumber(value));
}

function renderRealtimeAnalysis(record) {
  const data = normalizeAnalysisPayload(record);
  if (!data) return;

  state.latestAnalysis = data;

  const quote = data.technical?.quote || {};
  const technical = data.technical || {};
  const dashboard = data.dashboard || {};
  const strategy = data.strategy || {};
  const sentiment = data.sentiment || {};

  setText('metricCode', `${data.stockCode || '-'} ${data.stockName || ''}`.trim());
  setText('metricPrice', safeNum(quote.price));
  applyMetricColor('metricPrice', quote.changePct);

  setText('metricChange', signedPct(quote.changePct));
  applyMetricColor('metricChange', quote.changePct);

  setText('metricMa', `${safeNum(quote.ma5)} / ${safeNum(quote.ma10)} / ${safeNum(quote.ma20)}`);
  setText('metricVolumeRatio', safeNum(quote.volumeRatio));

  const sentimentScore = Number(sentiment.score ?? 0);
  setText('metricSentiment', `${sentiment.label || '-'} (${safeNum(sentimentScore, 0)})`);
  applyMetricColor('metricSentiment', sentimentScore - 50);

  setText('dashboardSummary', data.summary || dashboard.oneLiner || '暂无结论');
  setText('buyPrice', safeNum(data.buyPrice));
  setText('stopLoss', safeNum(data.stopLoss));
  setText('targetPrice', safeNum(data.targetPrice));
  setText('recommendation', data.recommendation || '-');

  const recoText = String(data.recommendation || '');
  const recoEl = $('recommendation');
  recoEl?.classList.remove('value-up', 'value-down', 'value-neutral');
  if (recoText.includes('偏多') || recoText.includes('低吸') || recoText.includes('持有')) recoEl?.classList.add('value-up');
  else if (recoText.includes('减仓') || recoText.includes('观望')) recoEl?.classList.add('value-down');
  else recoEl?.classList.add('value-neutral');

  const checklist = dashboard.checklist || technical.checklist || [];
  setHtml(
    'checklist',
    checklist.length
      ? checklist
          .map((item) => `
            <li>
              <strong>${escapeHtml(item.label || '-')}</strong>
              <span class="${item.status === '满足' ? 'value-up' : item.status === '不满足' ? 'value-down' : 'value-neutral'}">
                ${escapeHtml(item.status || '-')}
              </span>
              | ${escapeHtml(item.reason || '-')}
            </li>
          `)
          .join('')
      : '<li>暂无检查项</li>',
  );

  setText('strategySystem', strategy.system || '-');
  setText('strategyMode', strategy.mode || '-');
  setHtml(
    'strategyPlan',
    (strategy.plan || []).length
      ? (strategy.plan || []).map((line) => `<li>${escapeHtml(line)}</li>`).join('')
      : '<li>暂无策略计划</li>',
  );
  setText('strategyDisclaimer', strategy.disclaimer || '仅供参考，不构成投资建议。');

  const news = data.news || [];
  setHtml(
    'newsList',
    news.length
      ? news
          .map((item) => {
            const title = item.url && item.url !== '#'
              ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title || '-')}</a>`
              : escapeHtml(item.title || '-');
            return `
              <div class="list-item">
                <strong>${title}</strong>
                <div class="small">${escapeHtml(item.source || '-')} | ${escapeHtml(item.publishedAt || '-')}</div>
                <div class="small">${escapeHtml(item.snippet || '')}</div>
              </div>
            `;
          })
          .join('')
      : '<div class="muted">暂无新闻</div>',
  );

  const sectionLabels = {
    valuation: '估值',
    growth: '成长',
    earnings: '业绩',
    institution: '机构',
    capital_flow: '资金流',
    dragon_tiger: '龙虎榜',
    boards: '板块榜',
  };
  const sections = Object.keys(sectionLabels);
  const fundamental = data.fundamental_context || {};
  setHtml(
    'fundamentalGrid',
    sections
      .map((section) => {
        const sec = fundamental[section] || { status: 'degraded', data: {} };
        const rows = Object.entries(sec.data || {}).slice(0, 12).map(([k, v]) => {
          const text = summarizeValue(v);
          return `<div class="small"><strong>${escapeHtml(k)}</strong>: ${escapeHtml(text)}</div>`;
        });
        const statusClass = sec.status === 'ok' ? 'value-up' : sec.status === 'partial' ? 'value-neutral' : 'value-down';

        return `
          <div class="fund-card">
            <h4>${escapeHtml(sectionLabels[section] || section)} <span class="small muted">(${escapeHtml(section)})</span></h4>
            <div class="small ${statusClass}">${escapeHtml(sec.status || 'degraded')}</div>
            ${rows.length ? rows.join('') : '<div class="small muted">暂无数据</div>'}
          </div>
        `;
      })
      .join(''),
  );

  renderPriceChart(technical.latestCandles || []);
  renderVolumeChart(technical.latestCandles || []);
  renderChipChart(technical.volumeProfile || []);
}

function renderQuickMarket(payload, targetId = 'quickMarketView') {
  const root = $(targetId);
  if (!root) return;

  const regions = [];
  if (payload.cn) regions.push(payload.cn);
  if (payload.us) regions.push(payload.us);

  if (!regions.length) {
    root.innerHTML = '<div class="muted">暂无市场数据</div>';
    return;
  }

  root.innerHTML = regions
    .map((part) => {
      const score = Number(part.overview?.score || 50);
      const scoreClass = valueClassByNumber(score - 50);
      const indices = (part.indices || [])
        .map((idx) => `
          <div class="small">
            <strong>${escapeHtml(idx.code)}</strong>
            ${escapeHtml(safeNum(idx.price))}
            <span class="${valueClassByNumber(idx.changePct)}">${escapeHtml(signedPct(idx.changePct))}</span>
          </div>
        `)
        .join('');

      return `
        <div class="summary-card">
          <div class="label">${escapeHtml(part.region?.toUpperCase() || '-')} 市场</div>
          <div class="value ${scoreClass}">${escapeHtml(part.overview?.sentiment || 'neutral')} / ${safeNum(score, 0)}</div>
          <div class="small">${escapeHtml(part.overview?.text || '')}</div>
          ${indices}
        </div>
      `;
    })
    .join('');
}

function renderMarketCards(payload) {
  const root = $('marketReviewContainer');
  if (!root) return;

  const regions = [];
  if (payload.cn) regions.push(payload.cn);
  if (payload.us) regions.push(payload.us);

  if (!regions.length) {
    root.innerHTML = '<div class="muted">暂无复盘数据</div>';
    return;
  }

  root.innerHTML = regions
    .map((part) => {
      const top = (part.sectors?.top || [])
        .map((item) => `<li class="value-up">${escapeHtml(item.name)} ${escapeHtml(signedPct(item.changePct))}</li>`)
        .join('');
      const bottom = (part.sectors?.bottom || [])
        .map((item) => `<li class="value-down">${escapeHtml(item.name)} ${escapeHtml(signedPct(item.changePct))}</li>`)
        .join('');

      const indices = (part.indices || [])
        .map((idx) => `
          <div class="summary-card">
            <div class="label">${escapeHtml(idx.name || idx.code)}</div>
            <div class="value ${valueClassByNumber(idx.changePct)}">${escapeHtml(safeNum(idx.price))} (${escapeHtml(signedPct(idx.changePct))})</div>
          </div>
        `)
        .join('');

      return `
        <article class="panel">
          <h3>${escapeHtml(part.region?.toUpperCase() || '-')} 市场</h3>
          <p class="muted">${escapeHtml(part.overview?.text || '')}</p>
          <div class="summary-grid">${indices}</div>
          <div class="grid two" style="margin-top:10px">
            <div>
              <h4>领涨板块</h4>
              <ul class="plain-list">${top || '<li>暂无</li>'}</ul>
            </div>
            <div>
              <h4>领跌板块</h4>
              <ul class="plain-list">${bottom || '<li>暂无</li>'}</ul>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderFuturesCategorySelect() {
  const select = $('futuresCategorySelect');
  if (!select) return;

  const previous = Number(select.value || 0);
  const categories = state.futuresCategories || [];
  if (!categories.length) {
    select.innerHTML = '<option value="">暂无分类，请先新增</option>';
    renderFuturesManageList();
    return;
  }

  select.innerHTML = categories
    .map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`)
    .join('');

  const fallbackId = categories[0]?.id;
  const selected = categories.some((item) => item.id === previous) ? previous : fallbackId;
  select.value = String(selected ?? '');
  renderFuturesManageList();
}

function resetFuturesCategoryForm() {
  state.futuresCategoryEditingId = null;
  setValue('futuresCategoryNameInput', '');
  setValue('futuresCategoryDescInput', '');
  setText('createFuturesCategoryBtn', '确认新增');
  $('cancelFuturesCategoryEditBtn')?.classList.add('hidden');
}

function startEditFuturesCategory(categoryId) {
  const id = Number(categoryId);
  const target = (state.futuresCategories || []).find((item) => item.id === id);
  if (!target) {
    showBanner('futuresMsg', `分类不存在: ${id}`, true);
    return;
  }

  state.futuresCategoryEditingId = id;
  setValue('futuresCategoryNameInput', target.name || '');
  setValue('futuresCategoryDescInput', target.description || '');
  setText('createFuturesCategoryBtn', '保存修改');
  $('cancelFuturesCategoryEditBtn')?.classList.remove('hidden');
  $('futuresCategoryNameInput')?.focus();
}

function renderFuturesCategoryList() {
  const root = $('futuresCategoryList');
  if (!root) return;

  const rows = state.futuresCategories || [];
  if (!rows.length) {
    root.innerHTML = '<div class="muted">暂无分类</div>';
    return;
  }

  root.innerHTML = `
    <table class="table futures-manage-table">
      <thead>
        <tr>
          <th>名称</th>
          <th>说明</th>
          <th>品种数</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((item) => `
          <tr>
            <td>${escapeHtml(item.name || '-')}</td>
            <td class="small">${escapeHtml(item.description || '-')}</td>
            <td>${escapeHtml(String((item.symbols || []).length))}</td>
            <td>
              <button type="button" class="btn btn-secondary btn-mini" data-edit-category-id="${item.id}">编辑</button>
              <button
                type="button"
                class="btn btn-danger btn-mini"
                data-delete-category-id="${item.id}"
                data-delete-category-name="${escapeHtml(item.name || '')}"
              >删除</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderFuturesManageList() {
  const root = $('futuresManageList');
  if (!root) return;

  const categories = state.futuresCategories || [];
  const rows = categories.flatMap((category) =>
    (category.symbols || []).map((symbol) => ({
      ...symbol,
      categoryName: category.name,
    })));

  if (!rows.length) {
    root.innerHTML = '<div class="muted">暂无已添加品种</div>';
    return;
  }

  root.innerHTML = `
    <table class="table futures-manage-table">
      <thead>
        <tr>
          <th>分类</th>
          <th>品种</th>
          <th>代码</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((item) => `
          <tr>
            <td>${escapeHtml(item.categoryName || '-')}</td>
            <td>${escapeHtml(formatFuturesDisplayName(item.name || item.code || '-'))}</td>
            <td class="small">${escapeHtml(item.quoteCode || '-')}</td>
            <td>
              <button
                type="button"
                class="btn btn-danger btn-mini"
                data-delete-symbol-id="${item.id}"
                data-delete-symbol-name="${escapeHtml(formatFuturesDisplayName(item.name || item.code || ''))}"
              >删除</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderFuturesPresetSelect() {
  const select = $('futuresPresetSelect');
  if (!select) return;

  const presets = state.futuresPresets?.length ? state.futuresPresets : FUTURES_PRESET_SYMBOLS_FALLBACK;
  const grouped = new Map();
  presets.forEach((item) => {
    if (!grouped.has(item.exchange)) grouped.set(item.exchange, []);
    grouped.get(item.exchange).push(item);
  });

  const blocks = ['<option value="">手动输入（不使用预设）</option>'];
  grouped.forEach((items, exchange) => {
    const options = items
      .map((item) => `<option value="${escapeHtml(item.quoteCode)}" data-name="${escapeHtml(item.name)}">${escapeHtml(item.name)} (${escapeHtml(item.quoteCode)})</option>`)
      .join('');
    blocks.push(`<optgroup label="${escapeHtml(exchange)}">${options}</optgroup>`);
  });

  select.innerHTML = blocks.join('');
}

function renderFuturesTimeframeSelect() {
  const select = $('futuresTimeframeSelect');
  if (!select) return;

  const frames = state.futuresTimeframes || [];
  if (!frames.length) {
    select.innerHTML = '<option value="30s">30秒</option>';
    const saved = safeLocalStorageGet('futures.defaultTimeframe') || '30s';
    select.value = saved;
    syncFuturesKlineStateByTimeframe(select.value);
    return;
  }

  select.innerHTML = frames
    .map((item) => `<option value="${escapeHtml(item.key)}">${escapeHtml(item.label)}</option>`)
    .join('');

  const saved = safeLocalStorageGet('futures.defaultTimeframe') || '30s';
  if (frames.some((item) => item.key === saved)) {
    select.value = saved;
    syncFuturesKlineStateByTimeframe(select.value);
    return;
  }
  if (frames.some((item) => item.key === '30s')) {
    select.value = '30s';
    syncFuturesKlineStateByTimeframe(select.value);
    return;
  }
  if (frames[0]) {
    select.value = frames[0].key;
    syncFuturesKlineStateByTimeframe(select.value);
  }
}

function renderFuturesAutoRefreshSelect() {
  const select = $('futuresAutoRefreshSelect');
  if (!select) return;

  select.value = '30000';
  state.futuresAutoRefreshMs = 30000;
}

function renderFuturesSummary(payload) {
  if (!payload) {
    setHtml('futuresSummary', '<div class="muted">暂无监测数据</div>');
    return;
  }

  renderSummaryCards('futuresSummary', [
    { label: '监测品种', value: String(payload.total ?? 0), className: 'value-neutral' },
    { label: '成功', value: String(payload.success ?? 0), className: 'value-neutral' },
    { label: '失败', value: String(payload.failed ?? 0), className: 'value-neutral' },
    { label: '时间粒度', value: payload.timeframeLabel || payload.timeframe || '-', className: 'value-neutral' },
    { label: '自动刷新', value: state.futuresAutoRefreshMs > 0 ? `${Math.round(state.futuresAutoRefreshMs / 1000)}秒` : '关闭', className: 'value-neutral' },
    { label: '本轮刷新', value: formatDateTime(payload.fetchedAt), className: 'value-neutral' },
  ]);
}

function renderFuturesPriceChart(canvasId, chartKey, candles = [], prevClose = null, timeframe = '') {
  const canvas = $(canvasId);
  drawCanvas(canvas, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    if (!candles.length) {
      ctx.fillStyle = '#7d8cab';
      ctx.fillText('暂无价格数据', 14, 20);
      chartStore[chartKey] = null;
      return;
    }

    const rows = candles
      .map((item) => {
        const openRaw = Number(item.open);
        const closeRaw = Number(item.close);
        const highRaw = Number(item.high);
        const lowRaw = Number(item.low);
        const close = Number.isFinite(closeRaw) ? closeRaw : Number.NaN;
        const open = Number.isFinite(openRaw) ? openRaw : close;
        const high = Number.isFinite(highRaw) ? highRaw : Math.max(open, close);
        const low = Number.isFinite(lowRaw) ? lowRaw : Math.min(open, close);
        if (!Number.isFinite(close)) return null;
        return {
          date: item.date,
          open,
          high,
          low,
          close,
        };
      })
      .filter(Boolean);

    if (!rows.length) {
      ctx.fillStyle = '#7d8cab';
      ctx.fillText('暂无有效价格数据', 14, 20);
      chartStore[chartKey] = null;
      return;
    }

    const pad = { left: 42, right: 10, top: 14, bottom: 30 };
    const area = { x: pad.left, y: pad.top, w: w - pad.left - pad.right, h: h - pad.top - pad.bottom };
    drawGrid(ctx, area, 4, 6);

    const closes = rows.map((item) => item.close);
    const highs = rows.map((item) => item.high);
    const lows = rows.map((item) => item.low);
    const ma5 = calcMovingAverage(closes, 5);
    const ma10 = calcMovingAverage(closes, 10);
    const ma20 = calcMovingAverage(closes, 20);
    const minBase = Math.min(...(isFuturesLongKlineFrame(timeframe) ? lows : closes));
    const maxBase = Math.max(...(isFuturesLongKlineFrame(timeframe) ? highs : closes));
    const prevCloseNum = Number(prevClose);
    const hasPrevClose = Number.isFinite(prevCloseNum) && prevCloseNum > 0;
    const maExt = [...ma5, ...ma10, ...ma20].filter((item) => Number.isFinite(item));
    const min = hasPrevClose ? Math.min(minBase, prevCloseNum, ...(maExt.length ? maExt : [minBase])) : Math.min(minBase, ...(maExt.length ? maExt : [minBase]));
    const max = hasPrevClose ? Math.max(maxBase, prevCloseNum, ...(maExt.length ? maExt : [maxBase])) : Math.max(maxBase, ...(maExt.length ? maExt : [maxBase]));
    const span = Math.max(max - min, 0.01);

    const xAxis = getFuturesXAxis(rows, timeframe, area);
    const points = rows.map((item, idx) => ({
      x: xAxis.pointXByIndex(idx),
      y: area.y + ((max - Number(item.close || 0)) / span) * area.h,
      date: item.date,
      close: item.close,
      open: item.open,
      high: item.high,
      low: item.low,
      ma5: ma5[idx],
      ma10: ma10[idx],
      ma20: ma20[idx],
    }));

    const drawMA = (series = [], color = '#f59e0b', width = 1.4) => {
      const line = series
        .map((value, idx) => (Number.isFinite(value) ? { x: points[idx]?.x, y: area.y + ((max - value) / span) * area.h } : null))
        .filter((item) => item && Number.isFinite(item.x) && Number.isFinite(item.y));
      if (line.length < 2) return;
      ctx.beginPath();
      line.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.stroke();
    };

    if (isFuturesLongKlineFrame(timeframe)) {
      let minStep = Number.POSITIVE_INFINITY;
      for (let i = 1; i < points.length; i += 1) {
        const step = points[i].x - points[i - 1].x;
        if (step > 0 && step < minStep) minStep = step;
      }
      const approxStep = Number.isFinite(minStep) ? minStep : area.w / Math.max(points.length, 1);
      const bodyWidth = Math.max(4, Math.min(14, approxStep * 0.64));

      points.forEach((pt) => {
        const yOpen = area.y + ((max - pt.open) / span) * area.h;
        const yClose = area.y + ((max - pt.close) / span) * area.h;
        const yHigh = area.y + ((max - pt.high) / span) * area.h;
        const yLow = area.y + ((max - pt.low) / span) * area.h;
        const rising = pt.close >= pt.open;
        const color = rising ? '#dc2626' : '#16a34a';

        ctx.beginPath();
        ctx.moveTo(pt.x, yHigh);
        ctx.lineTo(pt.x, yLow);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = color;
        ctx.stroke();

        const top = Math.min(yOpen, yClose);
        const bodyH = Math.max(1.2, Math.abs(yClose - yOpen));
        const left = pt.x - bodyWidth / 2;

        if (rising) {
          ctx.fillStyle = 'rgba(255,255,255,0.98)';
          ctx.fillRect(left, top, bodyWidth, bodyH);
        } else {
          ctx.fillStyle = 'rgba(22, 163, 74, 0.9)';
          ctx.fillRect(left, top, bodyWidth, bodyH);
        }
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = color;
        ctx.strokeRect(left + 0.5, top + 0.5, Math.max(1, bodyWidth - 1), Math.max(1, bodyH - 1));
      });

      drawMA(ma5, '#f59e0b', 1.3);
      drawMA(ma10, '#d946ef', 1.3);
      drawMA(ma20, '#16a34a', 1.3);

      const last = points[points.length - 1] || {};
      const legendItems = [
        { label: `MA5 ${safeNum(last.ma5)}`, color: '#f59e0b' },
        { label: `MA10 ${safeNum(last.ma10)}`, color: '#d946ef' },
        { label: `MA20 ${safeNum(last.ma20)}`, color: '#16a34a' },
      ];
      let legendX = area.x + 4;
      const legendY = area.y + 10;
      ctx.font = '10px IBM Plex Mono';
      legendItems.forEach((item) => {
        if (item.label.includes('-')) return;
        ctx.fillStyle = item.color;
        ctx.fillText(item.label, legendX, legendY);
        legendX += ctx.measureText(item.label).width + 10;
      });
    } else {
      const gradient = ctx.createLinearGradient(0, area.y, 0, area.y + area.h);
      gradient.addColorStop(0, 'rgba(70, 95, 255, 0.24)');
      gradient.addColorStop(1, 'rgba(70, 95, 255, 0.02)');

      ctx.beginPath();
      points.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.lineTo(points[points.length - 1].x, area.y + area.h);
      ctx.lineTo(points[0].x, area.y + area.h);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      points.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = '#465fff';
      ctx.stroke();
    }

    ctx.fillStyle = '#7d8cab';
    ctx.font = '11px IBM Plex Mono';
    ctx.fillText(`MAX ${safeNum(max)}`, 6, 12);
    ctx.fillText(`MIN ${safeNum(min)}`, 6, h - 18);

    ctx.fillStyle = '#8ea0c4';
    ctx.font = '10px IBM Plex Mono';
    xAxis.tickLabels.forEach((tick) => {
      if (!tick) return;
      const label = tick.label || '-';
      const textW = ctx.measureText(label).width;
      const tx = Math.max(area.x, Math.min(area.x + area.w - textW, tick.x - textW / 2));
      ctx.fillText(label, tx, h - 6);
    });

    if (hasPrevClose) {
      const rawY = area.y + ((max - prevCloseNum) / span) * area.h;
      const baseY = Math.max(area.y + 1, Math.min(area.y + area.h - 1, rawY));
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.moveTo(area.x, baseY);
      ctx.lineTo(area.x + area.w, baseY);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ef4444';
      ctx.stroke();
      ctx.setLineDash([]);

      const baseLabel = `昨收 ${safeNum(prevCloseNum)}`;
      const lw = ctx.measureText(baseLabel).width + 10;
      ctx.fillStyle = 'rgba(239, 68, 68, 0.16)';
      ctx.fillRect(area.x + area.w - lw, Math.max(area.y + 2, baseY - 14), lw, 16);
      ctx.fillStyle = '#b91c1c';
      ctx.font = '10px IBM Plex Mono';
      ctx.fillText(baseLabel, area.x + area.w - lw + 5, Math.max(area.y + 14, baseY - 2));
    }

    chartStore[chartKey] = {
      type: 'line',
      points,
      format(point) {
        return [
          `<strong>${point.date || '-'}</strong>`,
          `开: ${safeNum(point.open)} 高: ${safeNum(point.high)}`,
          `低: ${safeNum(point.low)} 收: ${safeNum(point.close)}`,
          `MA5: ${safeNum(point.ma5)} MA10: ${safeNum(point.ma10)} MA20: ${safeNum(point.ma20)}`,
        ].join('<br/>');
      },
    };
  });
}

function renderFuturesVolumeChart(canvasId, chartKey, candles = [], timeframe = '') {
  const canvas = $(canvasId);
  drawCanvas(canvas, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    if (!candles.length) {
      ctx.fillStyle = '#7d8cab';
      ctx.fillText('暂无成交量数据', 14, 20);
      chartStore[chartKey] = null;
      return;
    }

    const pad = { left: 36, right: 10, top: 14, bottom: 20 };
    const area = { x: pad.left, y: pad.top, w: w - pad.left - pad.right, h: h - pad.top - pad.bottom };
    drawGrid(ctx, area, 4, 6);

    const maxVolume = Math.max(...candles.map((item) => Number(item.volume || 0)), 1);
    const xAxis = getFuturesXAxis(candles, timeframe, area);
    const xCenters = candles.map((_, idx) => xAxis.pointXByIndex(idx));
    let minStep = Number.POSITIVE_INFINITY;
    for (let i = 1; i < xCenters.length; i += 1) {
      const step = xCenters[i] - xCenters[i - 1];
      if (step > 0 && step < minStep) minStep = step;
    }
    const approxStep = Number.isFinite(minStep) ? minStep : area.w / Math.max(candles.length, 1);
    const barWidth = Math.max(2.2, Math.min(8, approxStep * 0.72));

    const points = candles.map((item, idx) => {
      const volume = Number(item.volume || 0);
      const close = Number(item.close || 0);
      const prevClose = idx > 0 ? Number(candles[idx - 1]?.close || close) : close;
      const barH = (volume / maxVolume) * area.h;
      const x = Math.max(
        area.x,
        Math.min(area.x + area.w - barWidth, xCenters[idx] - barWidth / 2),
      );
      const y = area.y + area.h - barH;
      const rising = close >= prevClose;
      ctx.fillStyle = rising ? 'rgba(220, 38, 38, 0.72)' : 'rgba(22, 163, 74, 0.72)';
      ctx.fillRect(x, y, barWidth, barH);

      return {
        x: x + barWidth / 2,
        y,
        volume,
        date: item.date,
      };
    });

    ctx.fillStyle = '#7d8cab';
    ctx.font = '11px IBM Plex Mono';
    ctx.fillText(`MAX ${compactNumber(maxVolume)}`, 6, 12);

    chartStore[chartKey] = {
      type: 'line',
      points,
      format(point) {
        return [
          `<strong>${point.date || '-'}</strong>`,
          `成交量：${compactNumber(point.volume)}`,
        ].join('<br/>');
      },
    };
  });
}

function renderFuturesMonitor(payload) {
  const root = $('futuresMonitorContainer');
  if (!root) return;

  state.futuresMonitor = payload;
  renderFuturesSummary(payload);

  const categories = payload?.categories || [];
  const items = payload?.items || [];
  if (!categories.length || !items.length) {
    root.innerHTML = '<div class="futures-empty">暂无监测品种，请先新增分类和品种。</div>';
    return;
  }

  const grouped = new Map();
  items.forEach((item) => {
    if (!grouped.has(item.categoryId)) grouped.set(item.categoryId, []);
    grouped.get(item.categoryId).push(item);
  });

  root.innerHTML = categories
    .map((category) => {
      const rows = grouped.get(category.id) || [];
      const activePreset = inferFuturesKlinePreset(payload?.timeframe || state.futuresKlinePreset);
      const klineSwitch = FUTURES_KLINE_PRESET_ITEMS
        .map((tab) => `
          <button
            type="button"
            class="kline-switch-btn ${activePreset === tab.key ? 'active' : ''}"
            data-kline-preset="${tab.key}"
          >${tab.label}</button>
        `)
        .join('');
      const cards = rows.length
        ? rows.map((item) => {
          const displayName = formatFuturesDisplayName(item.name || item.code);
          const priceId = `futures-price-${item.id}`;
          const volumeId = `futures-volume-${item.id}`;
          const quote = normalizeFuturesQuoteForUi(item.quote || {});
          const pctClass = cnMarketClassByNumber(quote.changePct);
          const pctDigits = Math.abs(Number(quote.changePct)) < 1 ? 3 : 2;
          const refreshedAt = formatDateTime(quote.fetchedAt || quote.tradeTime || payload?.fetchedAt);
          const sourceTip = item.candleDataSource
            ? `K线源: ${item.candleDataSource}${item.warning ? ` | ${item.warning}` : ''}`
            : '';
          return `
            <article class="futures-symbol-card">
              <div class="futures-symbol-head">
                <div class="futures-symbol-title">
                  <div class="futures-title-line">
                    <strong>${escapeHtml(displayName)}</strong>
                    ${sourceTip ? `<button type="button" class="hint-btn" title="${escapeHtml(sourceTip)}" aria-label="K线源信息">?</button>` : ''}
                  </div>
                  <div class="code">${escapeHtml(item.quoteCode || '-')}</div>
                </div>
                <div class="futures-symbol-actions">
                  <div class="futures-change-pct ${pctClass}">${escapeHtml(signedPct(quote.changePct, pctDigits))}</div>
                  <div class="futures-refresh-time small muted">最后刷新：${escapeHtml(refreshedAt)}</div>
                  <button type="button" class="btn btn-danger btn-mini" data-delete-symbol-id="${item.id}" data-delete-symbol-name="${escapeHtml(displayName)}">删除</button>
                </div>
              </div>

              <div class="futures-metrics">
                <div class="futures-metric"><div class="label">最新价</div><div class="value ${pctClass}">${escapeHtml(safeNum(quote.price))}</div></div>
                <div class="futures-metric"><div class="label">涨跌</div><div class="value ${pctClass}">${escapeHtml(signedNum(quote.change))}</div></div>
                <div class="futures-metric"><div class="label">持仓量</div><div class="value value-neutral">${escapeHtml(compactNumber(quote.openInterest))}</div></div>
                <div class="futures-metric"><div class="label">成交量</div><div class="value value-neutral">${escapeHtml(compactNumber(quote.volume))}</div></div>
              </div>

              ${item.error ? `<div class="small value-down" style="margin-top:8px">${escapeHtml(item.error)}</div>` : ''}

              <div class="futures-chart-wrap">
                <div class="futures-chart-head">
                  <h4>价格K线（${escapeHtml(item.timeframeLabel || item.timeframe || '-')}）</h4>
                  <div class="futures-kline-switch">${klineSwitch}</div>
                </div>
                <canvas id="${priceId}" height="170"></canvas>
              </div>

              <div class="futures-chart-wrap">
                <h4>成交量</h4>
                <canvas id="${volumeId}" height="120"></canvas>
              </div>
            </article>
          `;
        }).join('')
        : '<div class="futures-empty">该分类暂无品种</div>';

      return `
        <section class="futures-category-block">
          <div class="futures-category-title">
            <h4>${escapeHtml(category.name)}</h4>
            <span class="tag">${escapeHtml(String(rows.length))} 个品种</span>
          </div>
          <div class="futures-symbol-grid">${cards}</div>
        </section>
      `;
    })
    .join('');

  items.forEach((item) => {
    const priceId = `futures-price-${item.id}`;
    const volumeId = `futures-volume-${item.id}`;
    const priceKey = `futures_price_${item.id}`;
    const volumeKey = `futures_volume_${item.id}`;
    const quote = normalizeFuturesQuoteForUi(item.quote || {});
    renderFuturesPriceChart(priceId, priceKey, item.candles || [], quote.prevClose, item.timeframe);
    renderFuturesVolumeChart(volumeId, volumeKey, item.candles || [], item.timeframe);
    bindChartHover(priceId, priceKey);
    bindChartHover(volumeId, volumeKey);
  });
}

function renderImportTable() {
  const tbody = $('importTable')?.querySelector('tbody');
  if (!tbody) return;

  const items = state.importItems || [];
  tbody.innerHTML = items.length
    ? items
        .map((item) => `
          <tr>
            <td>${escapeHtml(item.code || '-')}</td>
            <td>${escapeHtml(item.name || '-')}</td>
            <td>${escapeHtml(safeNum(item.confidence, 2))}</td>
            <td>${confidenceBadge(item.confidenceLevel)}</td>
            <td>${escapeHtml(item.source || '-')}</td>
          </tr>
        `)
        .join('')
    : '<tr><td colspan="5" class="muted">暂无导入数据</td></tr>';
}

function renderHistoryList() {
  const root = $('historyList');
  if (!root) return;

  if (!state.history.length) {
    root.innerHTML = '<div class="muted">暂无历史记录</div>';
    return;
  }

  root.innerHTML = state.history
    .map((item) => {
      const checked = state.selectedHistoryIds.has(item.id) ? 'checked' : '';
      return `
        <div class="list-item" data-history-id="${item.id}">
          <strong>${escapeHtml(item.stockCode)} ${escapeHtml(item.stockName || '')}</strong>
          <div class="small">
            ${escapeHtml(item.analysisDate || '-')} |
            <span class="${valueClassByNumber(item.recommendation?.includes('减仓') ? -1 : item.recommendation?.includes('偏多') ? 1 : 0)}">${escapeHtml(item.recommendation || '-')}</span> |
            置信度 ${escapeHtml(safeNum(item.confidence, 0))}%
          </div>
          <label class="small"><input type="checkbox" data-check-id="${item.id}" ${checked}/> 选择</label>
        </div>
      `;
    })
    .join('');

  $$('[data-history-id]', root).forEach((node) => {
    node.addEventListener('click', async (event) => {
      if (event.target?.matches('input[type="checkbox"]')) return;
      await loadHistoryDetail(Number(node.dataset.historyId));
    });
  });

  $$('[data-check-id]', root).forEach((checkbox) => {
    checkbox.addEventListener('change', (event) => {
      const id = Number(event.target.dataset.checkId);
      if (event.target.checked) state.selectedHistoryIds.add(id);
      else state.selectedHistoryIds.delete(id);
    });
  });
}

function renderHistoryDetail(detail) {
  const reco = String(detail.recommendation || '');
  const recoClass = reco.includes('偏多') || reco.includes('低吸') || reco.includes('持有')
    ? 'value-up'
    : reco.includes('减仓') || reco.includes('观望')
      ? 'value-down'
      : 'value-neutral';

  const report = escapeHtml(detail.reportMarkdown || '暂无报告').replaceAll('\n', '<br/>');
  setHtml(
    'historyDetailView',
    `
      <div class="summary-grid">
        <div class="summary-card"><div class="label">股票</div><div class="value value-neutral">${escapeHtml(detail.stockCode || '-')} ${escapeHtml(detail.stockName || '')}</div></div>
        <div class="summary-card"><div class="label">分析日期</div><div class="value value-neutral">${escapeHtml(detail.analysisDate || '-')}</div></div>
        <div class="summary-card"><div class="label">建议动作</div><div class="value ${recoClass}">${escapeHtml(detail.recommendation || '-')}</div></div>
        <div class="summary-card"><div class="label">置信度</div><div class="value ${valueClassByNumber(Number(detail.confidence || 0) - 50)}">${escapeHtml(safeNum(detail.confidence, 0))}%</div></div>
        <div class="summary-card"><div class="label">买入点</div><div class="value value-neutral">${escapeHtml(safeNum(detail.buyPrice))}</div></div>
        <div class="summary-card"><div class="label">止损位</div><div class="value value-down">${escapeHtml(safeNum(detail.stopLoss))}</div></div>
        <div class="summary-card"><div class="label">目标位</div><div class="value value-up">${escapeHtml(safeNum(detail.targetPrice))}</div></div>
      </div>
      <div style="margin-top:10px;line-height:1.65">${report}</div>
    `,
  );
}

function renderBacktestSummary(summary = {}) {
  renderSummaryCards('backtestSummary', [
    { label: '样本总数', value: String(summary.total ?? 0), className: 'value-neutral' },
    { label: '平均收益', value: `${safeNum(summary.avgReturnPct)}%`, className: valueClassByNumber(summary.avgReturnPct) },
    { label: '方向胜率', value: `${safeNum(summary.directionHitRate)}%`, className: valueClassByNumber(summary.directionHitRate - 50) },
    { label: '止盈命中率', value: `${safeNum(summary.takeProfitHitRate)}%`, className: valueClassByNumber(summary.takeProfitHitRate - 50) },
    { label: '止损命中率', value: `${safeNum(summary.stopLossHitRate)}%`, className: valueClassByNumber(50 - summary.stopLossHitRate) },
    { label: '涨跌胜率', value: `${safeNum(summary.winRate)}%`, className: valueClassByNumber(summary.winRate - 50) },
  ]);
}

function renderPortfolioView(payload) {
  if (!payload || typeof payload !== 'object') {
    setHtml('portfolioView', '<div class="muted">暂无数据</div>');
    return;
  }

  const cards = [];
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'number') {
      cards.push({
        label: key,
        value: safeNum(value, 2),
        className: valueClassByNumber(value),
      });
      continue;
    }

    if (typeof value === 'string') {
      cards.push({ label: key, value, className: 'value-neutral' });
      continue;
    }

    if (Array.isArray(value)) {
      cards.push({ label: key, value: `${value.length} 条`, className: 'value-neutral' });
      continue;
    }
  }

  renderSummaryCards('portfolioView', cards.slice(0, 8));
}

function renderAuthStatus(payload) {
  if (!payload || typeof payload !== 'object') {
    setHtml('authStatusView', '<div class="muted">暂无状态</div>');
    return;
  }

  renderSummaryCards('authStatusView', [
    { label: '认证开关', value: payload.authEnabled ? '已启用' : '未启用', className: payload.authEnabled ? 'value-up' : 'value-neutral' },
    { label: '当前用户', value: payload.user?.username || '未登录', className: payload.user ? 'value-up' : 'value-neutral' },
    { label: '改密权限', value: payload.passwordChangeable ? '允许' : '禁用', className: payload.passwordChangeable ? 'value-neutral' : 'value-down' },
  ]);
}

async function loadTasks() {
  try {
    const payload = await api.analysis.tasks({ limit: 50 });
    state.tasks = payload.items || [];
    renderTaskList();
  } catch (error) {
    showBanner('realtimeMsg', `任务列表加载失败: ${error.message}`, true);
  }
}

async function runSingleAnalysis(customCode) {
  clearBanner('realtimeMsg');
  const stockCode = (customCode || $('singleCodeInput')?.value || '').trim();
  if (!stockCode) {
    showBanner('realtimeMsg', '请输入股票代码', true);
    return;
  }

  const payload = await api.analysis.trigger({ stockList: stockCode, async: false });
  const item = payload.items?.[0];
  if (!item) throw new Error('分析结果为空');

  renderRealtimeAnalysis(item);
  showBanner('realtimeMsg', `分析完成: ${item.stockCode}`);
  await loadHistory();
}

async function runBatchAnalysis() {
  clearBanner('realtimeMsg');
  const stockList = ($('batchCodesInput')?.value || '').trim();
  if (!stockList) {
    showBanner('realtimeMsg', '请输入批量股票代码', true);
    return;
  }

  const payload = await api.analysis.trigger({ stockList, async: true });
  showBanner('realtimeMsg', `任务已创建: ${payload.task.taskId}`);
  await loadTasks();
}

async function loadQuickMarket() {
  const region = $('quickMarketRegion')?.value || 'both';
  const payload = await api.market.review(region);
  renderQuickMarket(payload, 'quickMarketView');
}

async function loadMarketReview() {
  const region = $('marketRegionSelect')?.value || 'both';
  const payload = await api.market.review(region);
  renderMarketCards(payload);
}

async function loadFuturesCategories() {
  const payload = await api.futures.categories();
  state.futuresCategories = payload.items || [];
  renderFuturesCategorySelect();
  renderFuturesCategoryList();
}

async function loadFuturesTimeframes() {
  const payload = await api.futures.timeframes();
  state.futuresTimeframes = payload.items || [];
  renderFuturesTimeframeSelect();
}

async function loadFuturesPresets() {
  try {
    const payload = await api.futures.presets();
    state.futuresPresets = payload.items || [];
  } catch (error) {
    state.futuresPresets = [];
    showBanner('futuresMsg', `预设品种拉取失败，已使用本地预置: ${error.message}`, true);
  }
  renderFuturesPresetSelect();
}

function applyFuturesAutoRefresh({ runNow = false } = {}) {
  if (state.futuresAutoRefreshTimer) {
    clearInterval(state.futuresAutoRefreshTimer);
    state.futuresAutoRefreshTimer = null;
  }

  if (!Number.isFinite(state.futuresAutoRefreshMs) || state.futuresAutoRefreshMs <= 0) {
    return;
  }

  state.futuresAutoRefreshTimer = window.setInterval(async () => {
    try {
      await loadFuturesMonitor({ silent: true });
    } catch (error) {
      showBanner('futuresMsg', `自动刷新失败: ${error.message}`, true);
    }
  }, state.futuresAutoRefreshMs);

  if (runNow) {
    loadFuturesMonitor({ silent: true }).catch((error) => {
      showBanner('futuresMsg', `自动刷新失败: ${error.message}`, true);
    });
  }
}

function updateFuturesAutoRefresh(ms) {
  const next = Number(ms);
  state.futuresAutoRefreshMs = Number.isFinite(next) && next >= 0 ? next : 30000;
  applyFuturesAutoRefresh({ runNow: true });
  if (state.futuresMonitor) {
    renderFuturesSummary(state.futuresMonitor);
  }
}

async function loadFuturesMonitor({ silent = false } = {}) {
  if (state.futuresMonitorLoading) return;
  state.futuresMonitorLoading = true;
  try {
    if (!silent) clearBanner('futuresMsg');
    const timeframe = $('futuresTimeframeSelect')?.value || '30s';
    const limit = resolveFuturesMonitorLimit(timeframe);
    syncFuturesKlineStateByTimeframe(timeframe);
    const payload = await api.futures.monitor({
      timeframe,
      limit,
    });
    renderFuturesMonitor(payload);
    if (!silent) {
      showBanner('futuresMsg', `监测刷新完成：成功 ${payload.success || 0} / 失败 ${payload.failed || 0}`);
    }
  } finally {
    state.futuresMonitorLoading = false;
  }
}

async function switchFuturesKlinePreset(preset = 'minute') {
  const normalized = String(preset || 'minute');
  const nextTimeframe = resolveFuturesTimeframeByPreset(normalized);
  const select = $('futuresTimeframeSelect');
  if (select) {
    select.value = nextTimeframe;
  }
  safeLocalStorageSet('futures.defaultTimeframe', nextTimeframe);
  syncFuturesKlineStateByTimeframe(nextTimeframe);
  await loadFuturesMonitor({ silent: true });
}

async function createFuturesCategory() {
  clearBanner('futuresMsg');
  const editingId = state.futuresCategoryEditingId;
  const name = ($('futuresCategoryNameInput')?.value || '').trim();
  const description = ($('futuresCategoryDescInput')?.value || '').trim();
  if (!name) {
    showBanner('futuresMsg', '请输入分类名称', true);
    return;
  }

  if (editingId) {
    await api.futures.updateCategory(editingId, { name, description });
  } else {
    await api.futures.createCategory({ name, description });
  }

  resetFuturesCategoryForm();
  await loadFuturesCategories();
  await loadFuturesMonitor({ silent: true });
  showBanner('futuresMsg', editingId ? `分类已更新：${name}` : `分类已新增：${name}`);
}

async function deleteFuturesCategory(categoryId, categoryName = '') {
  const id = Number(categoryId);
  if (!Number.isFinite(id) || id <= 0) {
    showBanner('futuresMsg', '分类ID无效，无法删除', true);
    return;
  }

  const target = (state.futuresCategories || []).find((item) => item.id === id);
  const symbolCount = (target?.symbols || []).length;
  const confirmed = window.confirm(`确认删除分类「${categoryName || id}」吗？将同时删除该分类下 ${symbolCount} 个品种。`);
  if (!confirmed) return;

  await api.futures.deleteCategory(id);
  if (state.futuresCategoryEditingId === id) {
    resetFuturesCategoryForm();
  }
  await loadFuturesCategories();
  await loadFuturesMonitor({ silent: true });
  showBanner('futuresMsg', `已删除分类：${categoryName || id}`);
}

async function createFuturesSymbol() {
  clearBanner('futuresMsg');
  const categoryId = Number($('futuresCategorySelect')?.value || 0);
  const name = ($('futuresSymbolNameInput')?.value || '').trim();
  const quoteCode = ($('futuresSymbolCodeInput')?.value || '').trim();

  if (!Number.isFinite(categoryId) || categoryId <= 0) {
    showBanner('futuresMsg', '请先选择分类', true);
    return;
  }

  if (!quoteCode) {
    showBanner('futuresMsg', '请输入品种代码，如 101.SI00Y', true);
    return;
  }

  await api.futures.createSymbol({ categoryId, name, quoteCode });
  $('futuresSymbolNameInput').value = '';
  $('futuresSymbolCodeInput').value = '';
  const preset = $('futuresPresetSelect');
  if (preset) preset.value = '';
  await loadFuturesCategories();
  await loadFuturesMonitor({ silent: true });
  closeFuturesSymbolModal();
}

async function deleteFuturesSymbol(symbolId, symbolName = '') {
  const id = Number(symbolId);
  if (!Number.isFinite(id) || id <= 0) {
    showBanner('futuresMsg', '品种ID无效，无法删除', true);
    return;
  }

  const confirmed = window.confirm(`确认删除品种「${symbolName || id}」吗？`);
  if (!confirmed) return;

  await api.futures.deleteSymbol(id);
  showBanner('futuresMsg', `已删除品种：${symbolName || id}`);
  await loadFuturesCategories();
  await loadFuturesMonitor({ silent: true });
}

function marketLabel(market) {
  if (market === 'A') return 'A股';
  if (market === 'HK') return '港股';
  if (market === 'US') return '美股';
  return market || '-';
}

function renderStockBasicsQuickSelect() {
  const select = $('stockBasicsQuickSelect');
  if (!select) return;

  if (!state.stockBasics.length) {
    select.innerHTML = '<option value="">请先在基础数据页面检索/同步</option>';
    return;
  }

  const options = state.stockBasics
    .slice(0, 240)
    .map((item) => `
      <option value="${escapeHtml(item.code)}" data-name="${escapeHtml(item.name || '')}">
        [${escapeHtml(marketLabel(item.market))}] ${escapeHtml(item.code)} ${escapeHtml(item.name || '')}
      </option>
    `)
    .join('');
  select.innerHTML = `<option value="">请选择股票（可选）</option>${options}`;
}

function renderStockBasicsTable() {
  const tbody = $('stockBasicsTable')?.querySelector('tbody');
  if (!tbody) return;

  const rows = state.stockBasics || [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">暂无数据，请先同步或检索</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map((item) => `
      <tr class="stock-basics-row" data-stock-code="${escapeHtml(item.code)}" data-stock-market="${escapeHtml(item.market)}">
        <td class="stock-basics-nowrap">${escapeHtml(marketLabel(item.market))}</td>
        <td class="stock-basics-nowrap">${escapeHtml(item.subMarket || '-')}</td>
        <td class="mono stock-basics-nowrap">${escapeHtml(item.code || '-')}</td>
        <td class="stock-basics-nowrap">${escapeHtml(item.name || '-')}</td>
        <td class="stock-basics-nowrap">${escapeHtml(item.sector || '-')}</td>
      </tr>
    `)
    .join('');
}

function renderStockBasicsDetail(payload = null) {
  const root = $('stockBasicsDetail');
  if (!root) return;
  if (!payload) {
    root.innerHTML = '请选择左侧股票查看详情';
    return;
  }

  const local = payload.local || {};
  const quote = normalizeStockQuoteForUi(payload.remoteQuote || {});
  const pctClass = cnMarketClassByNumber(quote.changePct);
  const synced = local.syncedAt ? formatDateTime(local.syncedAt) : '-';
  const fetchedAt = quote.fetchedAt ? formatDateTime(quote.fetchedAt) : '-';

  root.innerHTML = `
    <div class="summary-grid">
      <div class="summary-card"><div class="label">市场</div><div class="value value-neutral">${escapeHtml(marketLabel(local.market || ''))}</div></div>
      <div class="summary-card"><div class="label">代码</div><div class="value value-neutral">${escapeHtml(payload.code || local.code || '-')}</div></div>
      <div class="summary-card"><div class="label">名称</div><div class="value value-neutral">${escapeHtml(local.name || '-')}</div></div>
      <div class="summary-card"><div class="label">子市场</div><div class="value value-neutral">${escapeHtml(local.subMarket || '-')}</div></div>
      <div class="summary-card"><div class="label">最新价</div><div class="value ${pctClass}">${escapeHtml(safeNum(quote.price))}</div></div>
      <div class="summary-card"><div class="label">涨跌幅</div><div class="value ${pctClass}">${escapeHtml(signedPct(quote.changePct))}</div></div>
      <div class="summary-card"><div class="label">本地同步时间</div><div class="value value-neutral">${escapeHtml(synced)}</div></div>
      <div class="summary-card"><div class="label">远程行情时间</div><div class="value value-neutral">${escapeHtml(fetchedAt)}</div></div>
    </div>
    ${payload.remoteQuoteError ? `<div class="banner" style="margin-top:10px;border-color:#fecdd3;background:#fff1f2;color:#be123c">远程行情获取失败（已 fail-open）：${escapeHtml(payload.remoteQuoteError)}</div>` : ''}
    <div class="summary-grid" style="margin-top:10px">
      <div class="summary-card"><div class="label">数据源</div><div class="value value-neutral">${escapeHtml(quote.dataSource || '-')}</div></div>
      <div class="summary-card"><div class="label">所属板块</div><div class="value value-neutral">${escapeHtml(local.sector || '-')}</div></div>
    </div>
  `;
}

async function searchStockBasics({ silent = false } = {}) {
  if (!silent) clearBanner('stockBasicsMsg');
  const market = ($('stockBasicsMarketSelect')?.value || '').trim();
  const q = ($('stockBasicsSearchInput')?.value || '').trim();
  const payload = await api.stockBasics.search({
    market,
    q,
    page: 1,
    limit: state.stockBasicsLimit,
  });
  state.stockBasics = payload.items || [];
  state.stockBasicsTotal = Number(payload.total || 0);
  state.stockBasicsPage = Number(payload.page || 1);
  renderStockBasicsTable();
  renderStockBasicsQuickSelect();

  if (!silent) {
    showBanner(
      'stockBasicsMsg',
      `检索完成：${state.stockBasics.length} / ${state.stockBasicsTotal} 条（当前页）`,
    );
  }
}

async function syncStockBasics() {
  clearBanner('stockBasicsMsg');
  const payload = await api.stockBasics.sync();
  await searchStockBasics({ silent: true });
  const failures = (payload.failedMarkets || [])
    .map((item) => `${item.market}: ${item.message}`)
    .join(' | ');
  showBanner(
    'stockBasicsMsg',
    `同步完成：总计 ${payload.total || 0} 条，A股 ${payload.markets?.find((x) => x.market === 'A')?.total || 0}，港股 ${payload.markets?.find((x) => x.market === 'HK')?.total || 0}，美股 ${payload.markets?.find((x) => x.market === 'US')?.total || 0}${failures ? `；部分市场失败：${failures}` : ''}`,
    Boolean(failures),
  );
}

async function loadStockBasicDetail(code, market = '') {
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode) return;
  const payload = await api.stockBasics.detail(normalizedCode, { market });
  renderStockBasicsDetail(payload);
}

function renderStockCategorySelect() {
  const select = $('stockCategorySelect');
  if (!select) return;

  const previous = Number(select.value || 0);
  const categories = state.stockMonitorCategories || [];
  if (!categories.length) {
    select.innerHTML = '<option value="">暂无分类，请先新增</option>';
    renderStockManageList();
    return;
  }

  select.innerHTML = categories
    .map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`)
    .join('');
  const fallbackId = categories[0]?.id;
  const selected = categories.some((item) => item.id === previous) ? previous : fallbackId;
  select.value = String(selected || '');
  renderStockManageList();
}

function resetStockCategoryForm() {
  state.stockCategoryEditingId = null;
  setValue('stockCategoryNameInput', '');
  setValue('stockCategoryDescInput', '');
  setText('createStockCategoryBtn', '确认新增');
  $('cancelStockCategoryEditBtn')?.classList.add('hidden');
}

function startEditStockCategory(categoryId) {
  const id = Number(categoryId);
  const target = (state.stockMonitorCategories || []).find((item) => item.id === id);
  if (!target) {
    showBanner('stockMsg', `分类不存在: ${id}`, true);
    return;
  }

  state.stockCategoryEditingId = id;
  setValue('stockCategoryNameInput', target.name || '');
  setValue('stockCategoryDescInput', target.description || '');
  setText('createStockCategoryBtn', '保存修改');
  $('cancelStockCategoryEditBtn')?.classList.remove('hidden');
  $('stockCategoryNameInput')?.focus();
}

function renderStockCategoryList() {
  const root = $('stockCategoryList');
  if (!root) return;

  const rows = state.stockMonitorCategories || [];
  if (!rows.length) {
    root.innerHTML = '<div class="muted">暂无分类</div>';
    return;
  }

  root.innerHTML = `
    <table class="table futures-manage-table">
      <thead>
        <tr>
          <th>名称</th>
          <th>说明</th>
          <th>股票数</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((item) => `
          <tr>
            <td>${escapeHtml(item.name || '-')}</td>
            <td class="small">${escapeHtml(item.description || '-')}</td>
            <td>${escapeHtml(String((item.symbols || []).length))}</td>
            <td>
              <button type="button" class="btn btn-secondary btn-mini" data-edit-stock-category-id="${item.id}">编辑</button>
              <button
                type="button"
                class="btn btn-danger btn-mini"
                data-delete-stock-category-id="${item.id}"
                data-delete-stock-category-name="${escapeHtml(item.name || '')}"
              >删除</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderStockManageList() {
  const root = $('stockManageList');
  if (!root) return;

  const categories = state.stockMonitorCategories || [];
  const rows = categories.flatMap((category) =>
    (category.symbols || []).map((symbol) => ({
      ...symbol,
      categoryName: category.name,
    })));

  if (!rows.length) {
    root.innerHTML = '<div class="muted">暂无已添加股票</div>';
    return;
  }

  root.innerHTML = `
    <table class="table futures-manage-table">
      <thead>
        <tr>
          <th>分类</th>
          <th>股票</th>
          <th>代码</th>
          <th>市场</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((item) => `
          <tr>
            <td>${escapeHtml(item.categoryName || '-')}</td>
            <td>${escapeHtml(item.name || '-')}</td>
            <td class="small">${escapeHtml(item.stockCode || '-')}</td>
            <td>${escapeHtml(marketLabel(item.market))}</td>
            <td>
              <button
                type="button"
                class="btn btn-danger btn-mini"
                data-delete-stock-symbol-id="${item.id}"
                data-delete-stock-symbol-name="${escapeHtml(item.name || item.stockCode || '')}"
              >删除</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderStockTimeframeSelect() {
  const select = $('stockTimeframeSelect');
  if (!select) return;

  const frames = state.stockMonitorTimeframes || [];
  if (!frames.length) {
    select.innerHTML = '<option value="1m">1分钟</option><option value="1d">日线</option><option value="1w">周线</option><option value="1M">月线</option>';
    const saved = safeLocalStorageGet('stock.defaultTimeframe') || '1m';
    select.value = saved;
    syncStockKlineStateByTimeframe(select.value);
    return;
  }

  select.innerHTML = frames
    .map((item) => `<option value="${escapeHtml(item.key)}">${escapeHtml(item.label)}</option>`)
    .join('');

  const saved = safeLocalStorageGet('stock.defaultTimeframe') || '1m';
  if (frames.some((item) => item.key === saved)) {
    select.value = saved;
  } else if (frames.some((item) => item.key === '1m')) {
    select.value = '1m';
  } else {
    select.value = frames[0].key;
  }
  syncStockKlineStateByTimeframe(select.value);
}

function renderStockAutoRefreshSelect() {
  const select = $('stockAutoRefreshSelect');
  if (!select) return;
  select.value = '30000';
  state.stockAutoRefreshMs = 30000;
}

function renderStockSummary(payload) {
  if (!payload) {
    setHtml('stockSummary', '<div class="muted">暂无监测数据</div>');
    return;
  }

  renderSummaryCards('stockSummary', [
    { label: '监测股票', value: String(payload.total ?? 0), className: 'value-neutral' },
    { label: '成功', value: String(payload.success ?? 0), className: 'value-neutral' },
    { label: '失败', value: String(payload.failed ?? 0), className: 'value-neutral' },
    { label: '时间粒度', value: payload.timeframeLabel || payload.timeframe || '-', className: 'value-neutral' },
    { label: '自动刷新', value: state.stockAutoRefreshMs > 0 ? `${Math.round(state.stockAutoRefreshMs / 1000)}秒` : '关闭', className: 'value-neutral' },
    { label: '本轮刷新', value: formatDateTime(payload.fetchedAt), className: 'value-neutral' },
  ]);
}

function resolveStockMonitorLimit(timeframe = '') {
  const tf = String(timeframe || '');
  return ['1d', '1w', '1M'].includes(tf) ? STOCK_LONG_KLINE_LIMIT : 120;
}

function renderStockMonitor(payload) {
  const root = $('stockMonitorContainer');
  if (!root) return;

  state.stockMonitor = payload;
  renderStockSummary(payload);

  const categories = payload?.categories || [];
  const items = payload?.items || [];
  if (!categories.length || !items.length) {
    root.innerHTML = '<div class="futures-empty">暂无监测股票，请先新增分类和股票。</div>';
    return;
  }

  const grouped = new Map();
  items.forEach((item) => {
    if (!grouped.has(item.categoryId)) grouped.set(item.categoryId, []);
    grouped.get(item.categoryId).push(item);
  });

  root.innerHTML = categories
    .map((category) => {
      const rows = grouped.get(category.id) || [];
      const activePreset = inferStockKlinePreset(payload?.timeframe || state.stockKlinePreset);
      const klineSwitch = FUTURES_KLINE_PRESET_ITEMS
        .map((tab) => `
          <button
            type="button"
            class="kline-switch-btn ${activePreset === tab.key ? 'active' : ''}"
            data-stock-kline-preset="${tab.key}"
          >${tab.label}</button>
        `)
        .join('');

      const cards = rows.length
        ? rows.map((item) => {
          const priceId = `stock-price-${item.id}`;
          const volumeId = `stock-volume-${item.id}`;
          const quote = normalizeStockQuoteForUi(item.quote || {});
          const pctClass = cnMarketClassByNumber(quote.changePct);
          const pctDigits = Math.abs(Number(quote.changePct)) < 1 ? 3 : 2;
          const refreshedAt = formatDateTime(quote.fetchedAt || payload?.fetchedAt);
          const sourceTip = [
            item.candleDataSource ? `K线源: ${item.candleDataSource}` : null,
            quote.dataSource ? `报价源: ${quote.dataSource}` : null,
            item.warning || null,
          ].filter(Boolean).join(' | ');

          return `
            <article class="futures-symbol-card">
              <div class="futures-symbol-head">
                <div class="futures-symbol-title">
                  <div class="futures-title-line">
                    <strong>${escapeHtml(item.name || item.stockCode || '-')}</strong>
                    ${sourceTip ? `<button type="button" class="hint-btn" title="${escapeHtml(sourceTip)}" aria-label="行情源信息">?</button>` : ''}
                  </div>
                  <div class="code">${escapeHtml(marketLabel(item.market))} · ${escapeHtml(item.stockCode || '-')}</div>
                </div>
                <div class="futures-symbol-actions">
                  <div class="futures-change-pct ${pctClass}">${escapeHtml(signedPct(quote.changePct, pctDigits))}</div>
                  <div class="futures-refresh-time small muted">最后刷新：${escapeHtml(refreshedAt)}</div>
                  <button type="button" class="btn btn-danger btn-mini" data-delete-stock-symbol-id="${item.id}" data-delete-stock-symbol-name="${escapeHtml(item.name || item.stockCode || '')}">删除</button>
                </div>
              </div>

              <div class="futures-metrics">
                <div class="futures-metric"><div class="label">最新价</div><div class="value ${pctClass}">${escapeHtml(safeNum(quote.price))}</div></div>
                <div class="futures-metric"><div class="label">涨跌</div><div class="value ${pctClass}">${escapeHtml(signedNum(quote.change))}</div></div>
                <div class="futures-metric"><div class="label">昨收</div><div class="value value-neutral">${escapeHtml(safeNum(quote.prevClose))}</div></div>
                <div class="futures-metric"><div class="label">成交量</div><div class="value value-neutral">${escapeHtml(compactNumber(quote.volume))}</div></div>
              </div>

              ${item.error ? `<div class="small value-down" style="margin-top:8px">${escapeHtml(item.error)}</div>` : ''}

              <div class="futures-chart-wrap">
                <div class="futures-chart-head">
                  <h4>价格K线（${escapeHtml(item.timeframeLabel || item.timeframe || '-')}）</h4>
                  <div class="futures-kline-switch">${klineSwitch}</div>
                </div>
                <canvas id="${priceId}" height="170"></canvas>
              </div>

              <div class="futures-chart-wrap">
                <h4>成交量</h4>
                <canvas id="${volumeId}" height="120"></canvas>
              </div>
            </article>
          `;
        }).join('')
        : '<div class="futures-empty">该分类暂无股票</div>';

      return `
        <section class="futures-category-block">
          <div class="futures-category-title">
            <h4>${escapeHtml(category.name)}</h4>
            <span class="tag">${escapeHtml(String(rows.length))} 只股票</span>
          </div>
          <div class="futures-symbol-grid">${cards}</div>
        </section>
      `;
    })
    .join('');

  items.forEach((item) => {
    const priceId = `stock-price-${item.id}`;
    const volumeId = `stock-volume-${item.id}`;
    const priceKey = `stock_price_${item.id}`;
    const volumeKey = `stock_volume_${item.id}`;
    const quote = normalizeStockQuoteForUi(item.quote || {});
    renderFuturesPriceChart(priceId, priceKey, item.candles || [], quote.prevClose, item.timeframe);
    renderFuturesVolumeChart(volumeId, volumeKey, item.candles || [], item.timeframe);
    bindChartHover(priceId, priceKey);
    bindChartHover(volumeId, volumeKey);
  });
}

async function loadStockMonitorCategories() {
  const payload = await api.stockMonitor.categories();
  state.stockMonitorCategories = payload.items || [];
  renderStockCategorySelect();
  renderStockCategoryList();
  renderStockManageList();
}

async function loadStockMonitorTimeframes() {
  const payload = await api.stockMonitor.timeframes();
  state.stockMonitorTimeframes = payload.items || [];
  renderStockTimeframeSelect();
}

function applyStockAutoRefresh({ runNow = false } = {}) {
  if (state.stockAutoRefreshTimer) {
    clearInterval(state.stockAutoRefreshTimer);
    state.stockAutoRefreshTimer = null;
  }

  if (!Number.isFinite(state.stockAutoRefreshMs) || state.stockAutoRefreshMs <= 0) {
    return;
  }

  state.stockAutoRefreshTimer = window.setInterval(async () => {
    try {
      await loadStockMonitor({ silent: true });
    } catch (error) {
      showBanner('stockMsg', `自动刷新失败: ${error.message}`, true);
    }
  }, state.stockAutoRefreshMs);

  if (runNow) {
    loadStockMonitor({ silent: true }).catch((error) => {
      showBanner('stockMsg', `自动刷新失败: ${error.message}`, true);
    });
  }
}

function updateStockAutoRefresh(ms) {
  const next = Number(ms);
  state.stockAutoRefreshMs = Number.isFinite(next) && next >= 0 ? next : 30000;
  applyStockAutoRefresh({ runNow: true });
  if (state.stockMonitor) {
    renderStockSummary(state.stockMonitor);
  }
}

async function loadStockMonitor({ silent = false } = {}) {
  if (state.stockMonitorLoading) return;
  state.stockMonitorLoading = true;
  try {
    if (!silent) clearBanner('stockMsg');
    const timeframe = $('stockTimeframeSelect')?.value || '1m';
    const limit = resolveStockMonitorLimit(timeframe);
    syncStockKlineStateByTimeframe(timeframe);
    const payload = await api.stockMonitor.monitor({ timeframe, limit });
    renderStockMonitor(payload);
    if (!silent) {
      showBanner('stockMsg', `监测刷新完成：成功 ${payload.success || 0} / 失败 ${payload.failed || 0}`);
    }
  } finally {
    state.stockMonitorLoading = false;
  }
}

async function switchStockKlinePreset(preset = 'minute') {
  const normalized = String(preset || 'minute');
  const nextTimeframe = resolveStockTimeframeByPreset(normalized);
  const select = $('stockTimeframeSelect');
  if (select) {
    select.value = nextTimeframe;
  }
  safeLocalStorageSet('stock.defaultTimeframe', nextTimeframe);
  syncStockKlineStateByTimeframe(nextTimeframe);
  await loadStockMonitor({ silent: true });
}

async function createStockCategory() {
  clearBanner('stockMsg');
  const editingId = state.stockCategoryEditingId;
  const name = ($('stockCategoryNameInput')?.value || '').trim();
  const description = ($('stockCategoryDescInput')?.value || '').trim();
  if (!name) {
    showBanner('stockMsg', '请输入分类名称', true);
    return;
  }

  if (editingId) {
    await api.stockMonitor.updateCategory(editingId, { name, description });
  } else {
    await api.stockMonitor.createCategory({ name, description });
  }

  resetStockCategoryForm();
  await loadStockMonitorCategories();
  await loadStockMonitor({ silent: true });
  showBanner('stockMsg', editingId ? `分类已更新：${name}` : `分类已新增：${name}`);
}

async function deleteStockCategory(categoryId, categoryName = '') {
  const id = Number(categoryId);
  if (!Number.isFinite(id) || id <= 0) {
    showBanner('stockMsg', '分类ID无效，无法删除', true);
    return;
  }

  const target = (state.stockMonitorCategories || []).find((item) => item.id === id);
  const symbolCount = (target?.symbols || []).length;
  const confirmed = window.confirm(`确认删除分类「${categoryName || id}」吗？将同时删除该分类下 ${symbolCount} 只股票。`);
  if (!confirmed) return;

  await api.stockMonitor.deleteCategory(id);
  if (state.stockCategoryEditingId === id) {
    resetStockCategoryForm();
  }
  await loadStockMonitorCategories();
  await loadStockMonitor({ silent: true });
  showBanner('stockMsg', `已删除分类：${categoryName || id}`);
}

async function createStockSymbol() {
  clearBanner('stockMsg');
  const categoryId = Number($('stockCategorySelect')?.value || 0);
  const stockCode = ($('stockSymbolCodeInput')?.value || '').trim().toUpperCase();
  const name = ($('stockSymbolNameInput')?.value || '').trim();

  if (!Number.isFinite(categoryId) || categoryId <= 0) {
    showBanner('stockMsg', '请先选择分类', true);
    return;
  }

  if (!stockCode) {
    showBanner('stockMsg', '请输入股票代码，如 600519 / 00700 / AAPL', true);
    return;
  }

  await api.stockMonitor.createSymbol({ categoryId, stockCode, name });
  setValue('stockSymbolCodeInput', '');
  setValue('stockSymbolNameInput', '');
  const quickSelect = $('stockBasicsQuickSelect');
  if (quickSelect) quickSelect.value = '';
  await loadStockMonitorCategories();
  await loadStockMonitor({ silent: true });
  closeStockSymbolModal();
}

async function deleteStockSymbol(symbolId, symbolName = '') {
  const id = Number(symbolId);
  if (!Number.isFinite(id) || id <= 0) {
    showBanner('stockMsg', '股票ID无效，无法删除', true);
    return;
  }

  const confirmed = window.confirm(`确认删除股票「${symbolName || id}」吗？`);
  if (!confirmed) return;

  await api.stockMonitor.deleteSymbol(id);
  showBanner('stockMsg', `已删除股票：${symbolName || id}`);
  await loadStockMonitorCategories();
  await loadStockMonitor({ silent: true });
}

async function parseImportText() {
  clearBanner('importMsg');
  const text = ($('importTextInput')?.value || '').trim();
  if (!text) {
    showBanner('importMsg', '请输入文本内容', true);
    return;
  }

  const payload = await api.stocks.parseImportText(text);
  state.importItems = payload.items || [];
  renderImportTable();
  showBanner('importMsg', `解析完成，共 ${payload.total || state.importItems.length} 条`);
}

async function parseImportFile() {
  clearBanner('importMsg');
  const file = $('importFileInput')?.files?.[0];
  if (!file) {
    showBanner('importMsg', '请先选择文件', true);
    return;
  }

  const payload = await api.stocks.parseImportFile(file);
  state.importItems = payload.items || [];
  renderImportTable();
  showBanner('importMsg', `文件解析完成，共 ${payload.total || state.importItems.length} 条`);
}

async function extractImage() {
  clearBanner('importMsg');
  const file = $('importFileInput')?.files?.[0];
  if (!file) {
    showBanner('importMsg', '请先选择图片文件', true);
    return;
  }

  const payload = await api.stocks.extractFromImage(file);
  state.importItems = payload.items || [];
  renderImportTable();
  showBanner('importMsg', `图片提取完成，共 ${payload.total || state.importItems.length} 条`);
}

async function useImportForAnalysis() {
  const codes = (state.importItems || []).map((item) => item.code).filter(Boolean);
  if (!codes.length) {
    showBanner('importMsg', '导入结果为空，无法发起分析', true);
    return;
  }

  $('batchCodesInput').value = codes.join(',');
  activateTab('realtime');
  await withLoading('runBatchBtn', '提交中...', () => runBatchAnalysis(), {
    global: true,
    globalText: '正在提交批量分析任务...',
  });
}

async function loadHistory() {
  const payload = await api.history.list({ page: 1, limit: 200 });
  state.history = payload.items || [];
  renderHistoryList();
}

async function loadHistoryDetail(id) {
  const detail = await api.history.detail(id);
  const normalized = normalizeAnalysisPayload(detail);
  renderHistoryDetail(normalized);
  renderRealtimeAnalysis(normalized);
}

function toggleSelectAllHistory() {
  if (!state.history.length) return;
  if (state.selectedHistoryIds.size === state.history.length) {
    state.selectedHistoryIds.clear();
  } else {
    state.history.forEach((item) => state.selectedHistoryIds.add(item.id));
  }
  renderHistoryList();
}

async function deleteHistoryBatch() {
  const ids = Array.from(state.selectedHistoryIds);
  if (!ids.length) {
    setHtml('historyDetailView', '<div class="muted">请先勾选要删除的记录</div>');
    return;
  }

  await api.history.deleteBatch(ids);
  state.selectedHistoryIds.clear();
  await loadHistory();
  setHtml('historyDetailView', `<div class="value-up">已删除 ${ids.length} 条记录</div>`);
}

async function runBacktest() {
  const evaluationDays = Number($('backtestDaysInput')?.value || 5);
  const stockCode = ($('backtestStockInput')?.value || '').trim() || undefined;

  await api.backtest.run({ evaluationDays, stockCode, force: true });
  await refreshBacktest();
}

async function refreshBacktest() {
  const days = Number($('backtestDaysInput')?.value || 5);
  const summary = await api.backtest.overall(days);
  renderBacktestSummary(summary);

  const byStock = await api.backtest.byStock(days);
  const tbody = $('backtestTable')?.querySelector('tbody');
  if (!tbody) return;

  tbody.innerHTML = (byStock || []).length
    ? byStock
        .map((item) => `
          <tr>
            <td>${escapeHtml(item.stockCode)}</td>
            <td>${escapeHtml(String(item.total))}</td>
            <td class="${valueClassByNumber(item.directionHitRate - 50)}">${escapeHtml(safeNum(item.directionHitRate))}%</td>
            <td class="${valueClassByNumber(item.takeProfitHitRate - 50)}">${escapeHtml(safeNum(item.takeProfitHitRate))}%</td>
            <td class="${valueClassByNumber(50 - item.stopLossHitRate)}">${escapeHtml(safeNum(item.stopLossHitRate))}%</td>
            <td class="${valueClassByNumber(item.avgReturnPct)}">${escapeHtml(safeNum(item.avgReturnPct))}%</td>
          </tr>
        `)
        .join('')
    : '<tr><td colspan="6" class="muted">暂无回测数据</td></tr>';
}

function renderStrategyTags(items = []) {
  setHtml(
    'strategyTags',
    (items || []).map((item) => `<span class="tag ${item.enabled ? 'on' : ''}">${escapeHtml(item.name)}</span>`).join('') || '<span class="muted">暂无策略</span>',
  );
}

async function loadStrategies() {
  const strategies = await api.agent.strategies();
  renderStrategyTags(strategies || []);
}

async function sendAgentMessage() {
  const message = ($('agentInput')?.value || '').trim();
  if (!message) {
    setHtml('agentReplyView', '<div class="muted">请输入问题</div>');
    return;
  }

  const payload = await api.agent.chat({ message, sessionId: state.currentSessionId });
  state.currentSessionId = payload.sessionId;
  setHtml('agentReplyView', `<pre class="mono">${escapeHtml(payload.message || '')}</pre>`);
  await loadSessions();
  await loadSessionMessages(payload.sessionId);
}

async function loadSessions() {
  const payload = await api.agent.sessions();
  const root = $('agentSessionList');
  if (!root) return;

  const items = payload.items || [];
  root.innerHTML = items.length
    ? items
        .map((item) => `
          <div class="list-item" data-session-id="${escapeHtml(item.sessionId)}">
            <strong>${escapeHtml(item.title || item.sessionId.slice(0, 8))}</strong>
            <div class="small">${escapeHtml(item.updatedAt || '-')} | ${escapeHtml(String(item.messageCount || 0))} 条</div>
          </div>
        `)
        .join('')
    : '<div class="muted">暂无会话</div>';

  $$('[data-session-id]', root).forEach((node) => {
    node.addEventListener('click', async () => {
      state.currentSessionId = node.dataset.sessionId;
      await loadSessionMessages(state.currentSessionId);
    });
  });
}

async function loadSessionMessages(sessionId) {
  const payload = await api.agent.sessionMessages(sessionId);
  const root = $('agentMessageList');
  if (!root) return;

  const items = payload.items || [];
  root.innerHTML = items.length
    ? items
        .map((item) => `
          <div class="list-item">
            <strong>${item.role === 'assistant' ? 'AI' : '用户'}</strong>
            <div class="small">${escapeHtml(item.createdAt || '-')}</div>
            <div>${escapeHtml(item.content || '')}</div>
          </div>
        `)
        .join('')
    : '<div class="muted">暂无消息</div>';
}

async function createAccount() {
  clearBanner('portfolioMsg');
  const name = ($('accountNameInput')?.value || '').trim();
  if (!name) {
    showBanner('portfolioMsg', '请输入账户名称', true);
    return;
  }

  await api.portfolio.createAccount({ name, baseCurrency: 'CNY' });
  $('accountNameInput').value = '';
  showBanner('portfolioMsg', '账户创建成功');
  await loadAccounts();
}

async function createTrade() {
  clearBanner('portfolioMsg');
  const payload = JSON.parse(($('tradeJsonInput')?.value || '{}').trim());
  await api.portfolio.createTrade(payload);
  showBanner('portfolioMsg', '交易创建成功');
  await loadPortfolioView('snapshot');
}

async function loadAccounts() {
  const payload = await api.portfolio.accounts();
  const root = $('accountList');
  if (!root) return;

  const items = payload.items || [];
  root.innerHTML = items.length
    ? items
        .map((item) => `
          <div class="list-item" data-account-id="${item.id}">
            <strong>${escapeHtml(item.name)}</strong>
            <div class="small">${escapeHtml(item.baseCurrency)} | ${escapeHtml(item.updatedAt || '-')}</div>
          </div>
        `)
        .join('')
    : '<div class="muted">暂无账户</div>';

  $$('[data-account-id]', root).forEach((node) => {
    node.addEventListener('click', () => {
      state.activeAccountId = Number(node.dataset.accountId);
      showBanner('portfolioMsg', `当前账户: ${state.activeAccountId}`);
    });
  });
}

async function loadPortfolioView(type = 'snapshot') {
  const payload = type === 'risk'
    ? await api.portfolio.riskReport(state.activeAccountId)
    : await api.portfolio.snapshot(state.activeAccountId);
  renderPortfolioView(payload);
}

async function loadAuthStatus() {
  const payload = await api.auth.status();
  renderAuthStatus(payload);
}

async function login() {
  clearBanner('systemMsg');
  await api.auth.login({
    username: ($('loginUserInput')?.value || 'admin').trim() || 'admin',
    password: $('loginPwdInput')?.value || '',
  });
  showBanner('systemMsg', '登录成功');
  await loadAuthStatus();
}

async function logout() {
  clearBanner('systemMsg');
  await api.auth.logout();
  showBanner('systemMsg', '已退出');
  await loadAuthStatus();
}

async function setAuthEnabled(enabled) {
  clearBanner('systemMsg');
  await api.auth.updateSettings({
    authEnabled: enabled,
    currentPassword: $('enableAuthPwdInput')?.value || '',
  });
  showBanner('systemMsg', enabled ? '认证已启用' : '认证已关闭');
  await loadAuthStatus();
}

async function changePassword() {
  clearBanner('systemMsg');
  await api.auth.changePassword({
    username: ($('loginUserInput')?.value || 'admin').trim() || 'admin',
    currentPassword: $('oldPwdInput')?.value || '',
    newPassword: $('newPwdInput')?.value || '',
  });
  showBanner('systemMsg', '密码修改成功');
}

async function loadConfig() {
  const payload = await api.system.config();
  const obj = {};
  (payload.items || []).forEach((item) => {
    obj[item.key] = item.value;
  });
  $('configEditor').value = JSON.stringify(obj, null, 2);
}

async function saveConfig() {
  clearBanner('systemMsg');
  const body = JSON.parse($('configEditor')?.value || '{}');
  await api.system.updateConfig(body);
  showBanner('systemMsg', '配置保存成功');
  await loadConfig();
}

async function testEmail() {
  clearBanner('systemMsg');
  const payload = await api.system.testEmail();
  showBanner('systemMsg', payload.sent ? `测试邮件发送成功: ${payload.messageId}` : `邮件未发送: ${payload.reason}`);
}

async function updateHealth() {
  const el = $('healthStatus');
  if (!el) return;
  try {
    const payload = await api.health();
    el.textContent = `服务正常 | ${payload.timestamp}`;
  } catch {
    el.textContent = '服务不可用';
  }
}

function connectTaskStream() {
  const source = new EventSource('/api/v1/analysis/tasks/stream', { withCredentials: true });

  source.addEventListener('task_created', (event) => {
    const payload = JSON.parse(event.data);
    state.tasks.unshift(payload);
    renderTaskList();
  });

  source.addEventListener('task_started', (event) => {
    const payload = JSON.parse(event.data);
    state.tasks = state.tasks.map((task) => (task.taskId === payload.taskId ? payload : task));
    renderTaskList();
  });

  source.addEventListener('task_completed', async (event) => {
    const payload = JSON.parse(event.data);
    state.tasks = state.tasks.map((task) => (task.taskId === payload.taskId ? payload : task));
    renderTaskList();
    await loadHistory();
  });

  source.addEventListener('task_failed', (event) => {
    const payload = JSON.parse(event.data);
    state.tasks = state.tasks.map((task) => (task.taskId === payload.taskId ? payload : task));
    renderTaskList();
  });
}

function bindEvents() {
  $('runSingleBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('runSingleBtn', '分析中...', () => runSingleAnalysis(), {
        global: true,
        globalText: '正在分析股票，请稍候...',
      });
    } catch (error) {
      showBanner('realtimeMsg', `分析失败: ${error.message}`, true);
    }
  });

  $('runBatchBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('runBatchBtn', '提交中...', () => runBatchAnalysis(), {
        global: true,
        globalText: '正在提交批量任务...',
      });
    } catch (error) {
      showBanner('realtimeMsg', `任务创建失败: ${error.message}`, true);
    }
  });

  $('refreshQuickMarketBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('refreshQuickMarketBtn', '刷新中...', () => loadQuickMarket());
    } catch (error) {
      setHtml('quickMarketView', `<div class="value-down">加载失败: ${escapeHtml(error.message)}</div>`);
    }
  });

  $('loadMarketBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('loadMarketBtn', '加载中...', () => loadMarketReview());
    } catch (error) {
      setHtml('marketReviewContainer', `<div class="value-down">加载失败: ${escapeHtml(error.message)}</div>`);
    }
  });

  $('createFuturesCategoryBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('createFuturesCategoryBtn', state.futuresCategoryEditingId ? '保存中...' : '创建中...', () => createFuturesCategory());
    } catch (error) {
      showBanner('futuresMsg', `分类处理失败: ${error.message}`, true);
    }
  });

  $('cancelFuturesCategoryEditBtn')?.addEventListener('click', () => {
    resetFuturesCategoryForm();
  });

  $('createFuturesSymbolBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('createFuturesSymbolBtn', '添加中...', () => createFuturesSymbol(), {
        global: true,
        globalText: '正在添加期货品种并刷新监测...',
      });
    } catch (error) {
      showBanner('futuresMsg', `品种添加失败: ${error.message}`, true);
    }
  });

  $('refreshFuturesMonitorBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('refreshFuturesMonitorBtn', '刷新中...', () => loadFuturesMonitor(), {
        global: true,
        globalText: '正在拉取期货实时行情...',
      });
    } catch (error) {
      showBanner('futuresMsg', `监测刷新失败: ${error.message}`, true);
      setHtml('futuresMonitorContainer', `<div class="futures-empty value-down">监测加载失败: ${escapeHtml(error.message)}</div>`);
    }
  });

  $('futuresTimeframeSelect')?.addEventListener('change', async () => {
    try {
      const timeframe = $('futuresTimeframeSelect')?.value || '30s';
      safeLocalStorageSet('futures.defaultTimeframe', timeframe);
      syncFuturesKlineStateByTimeframe(timeframe);
      await withLoading('refreshFuturesMonitorBtn', '刷新中...', () => loadFuturesMonitor());
    } catch (error) {
      showBanner('futuresMsg', `监测刷新失败: ${error.message}`, true);
    }
  });

  $('futuresAutoRefreshSelect')?.addEventListener('change', async (event) => {
    const ms = Number(event.currentTarget?.value || 30000);
    updateFuturesAutoRefresh(ms);
    try {
      await withLoading('refreshFuturesMonitorBtn', '刷新中...', () => loadFuturesMonitor({ silent: true }));
      showBanner('futuresMsg', `自动刷新已更新：${ms > 0 ? `${Math.round(ms / 1000)}秒` : '关闭'}`);
    } catch (error) {
      showBanner('futuresMsg', `自动刷新设置失败: ${error.message}`, true);
    }
  });

  $('futuresPresetSelect')?.addEventListener('change', (event) => {
    const option = event.currentTarget?.selectedOptions?.[0];
    if (!option || !option.value) return;
    const presetName = option.dataset?.name || '';
    const presetCode = option.value || '';
    setValue('futuresSymbolNameInput', presetName);
    setValue('futuresSymbolCodeInput', presetCode);
  });

  $('openFuturesCategoryModalBtn')?.addEventListener('click', () => {
    openFuturesCategoryModal();
  });

  $('closeFuturesCategoryModalBtn')?.addEventListener('click', () => {
    closeFuturesCategoryModal();
  });

  $('futuresCategoryModal')?.addEventListener('click', (event) => {
    if (event.target.id === 'futuresCategoryModal') {
      closeFuturesCategoryModal();
    }
  });

  $('futuresCategoryList')?.addEventListener('click', async (event) => {
    const editBtn = event.target.closest('[data-edit-category-id]');
    if (editBtn) {
      startEditFuturesCategory(editBtn.dataset.editCategoryId);
      return;
    }

    const deleteBtn = event.target.closest('[data-delete-category-id]');
    if (!deleteBtn) return;

    const categoryId = Number(deleteBtn.dataset.deleteCategoryId);
    const categoryName = deleteBtn.dataset.deleteCategoryName || '';
    try {
      await withLoading('createFuturesCategoryBtn', '处理中...', () => deleteFuturesCategory(categoryId, categoryName), {
        global: true,
        globalText: '正在删除分类并刷新监测...',
      });
    } catch (error) {
      showBanner('futuresMsg', `分类删除失败: ${error.message}`, true);
    }
  });

  $('openFuturesSymbolModalBtn')?.addEventListener('click', async () => {
    try {
      await openFuturesSymbolModal();
    } catch (error) {
      showBanner('futuresMsg', `打开品种面板失败: ${error.message}`, true);
    }
  });

  $('closeFuturesSymbolModalBtn')?.addEventListener('click', () => {
    closeFuturesSymbolModal();
  });

  $('futuresSymbolModal')?.addEventListener('click', (event) => {
    if (event.target.id === 'futuresSymbolModal') {
      closeFuturesSymbolModal();
    }
  });

  $('openFuturesConsoleModalBtn')?.addEventListener('click', () => {
    openFuturesConsoleModal();
  });

  $('closeFuturesConsoleModalBtn')?.addEventListener('click', () => {
    closeFuturesConsoleModal();
  });

  $('futuresConsoleModal')?.addEventListener('click', (event) => {
    if (event.target.id === 'futuresConsoleModal') {
      closeFuturesConsoleModal();
    }
  });

  $('futuresMonitorContainer')?.addEventListener('click', async (event) => {
    const presetBtn = event.target.closest('[data-kline-preset]');
    if (presetBtn) {
      const preset = presetBtn.dataset.klinePreset || 'minute';
      try {
        await withLoading('refreshFuturesMonitorBtn', '切换中...', () => switchFuturesKlinePreset(preset));
        const label = FUTURES_KLINE_PRESET_ITEMS.find((item) => item.key === preset)?.label || preset;
        showBanner('futuresMsg', `已切换K线：${label}`);
      } catch (error) {
        showBanner('futuresMsg', `切换K线失败: ${error.message}`, true);
      }
      return;
    }

    const btn = event.target.closest('[data-delete-symbol-id]');
    if (!btn) return;
    const symbolId = Number(btn.dataset.deleteSymbolId);
    const symbolName = btn.dataset.deleteSymbolName || '';
    try {
      await withLoading('refreshFuturesMonitorBtn', '刷新中...', () => deleteFuturesSymbol(symbolId, symbolName), {
        global: true,
        globalText: '正在删除品种并刷新监测...',
      });
    } catch (error) {
      showBanner('futuresMsg', `删除失败: ${error.message}`, true);
    }
  });

  $('futuresManageList')?.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-delete-symbol-id]');
    if (!btn) return;
    const symbolId = Number(btn.dataset.deleteSymbolId);
    const symbolName = btn.dataset.deleteSymbolName || '';
    try {
      await withLoading('createFuturesSymbolBtn', '处理中...', () => deleteFuturesSymbol(symbolId, symbolName), {
        global: true,
        globalText: '正在删除期货品种...',
      });
    } catch (error) {
      showBanner('futuresMsg', `删除失败: ${error.message}`, true);
    }
  });

  $('syncStockBasicsBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('syncStockBasicsBtn', '同步中...', () => syncStockBasics(), {
        global: true,
        globalText: '正在同步三大市场股票基础数据...',
      });
    } catch (error) {
      showBanner('stockBasicsMsg', `同步失败: ${error.message}`, true);
    }
  });

  $('searchStockBasicsBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('searchStockBasicsBtn', '检索中...', () => searchStockBasics());
    } catch (error) {
      showBanner('stockBasicsMsg', `检索失败: ${error.message}`, true);
    }
  });

  $('stockBasicsSearchInput')?.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    try {
      await withLoading('searchStockBasicsBtn', '检索中...', () => searchStockBasics());
    } catch (error) {
      showBanner('stockBasicsMsg', `检索失败: ${error.message}`, true);
    }
  });

  $('stockBasicsMarketSelect')?.addEventListener('change', async () => {
    try {
      await withLoading('searchStockBasicsBtn', '检索中...', () => searchStockBasics());
    } catch (error) {
      showBanner('stockBasicsMsg', `检索失败: ${error.message}`, true);
    }
  });

  $('stockBasicsTable')?.addEventListener('click', async (event) => {
    const row = event.target.closest('[data-stock-code]');
    if (!row) return;
    try {
      await loadStockBasicDetail(row.dataset.stockCode, row.dataset.stockMarket || '');
    } catch (error) {
      showBanner('stockBasicsMsg', `详情加载失败: ${error.message}`, true);
    }
  });

  $('openStockCategoryModalBtn')?.addEventListener('click', () => {
    openStockCategoryModal();
  });

  $('closeStockCategoryModalBtn')?.addEventListener('click', () => {
    closeStockCategoryModal();
  });

  $('stockCategoryModal')?.addEventListener('click', (event) => {
    if (event.target.id === 'stockCategoryModal') {
      closeStockCategoryModal();
    }
  });

  $('createStockCategoryBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('createStockCategoryBtn', state.stockCategoryEditingId ? '保存中...' : '创建中...', () => createStockCategory());
    } catch (error) {
      showBanner('stockMsg', `分类处理失败: ${error.message}`, true);
    }
  });

  $('cancelStockCategoryEditBtn')?.addEventListener('click', () => {
    resetStockCategoryForm();
  });

  $('stockCategoryList')?.addEventListener('click', async (event) => {
    const editBtn = event.target.closest('[data-edit-stock-category-id]');
    if (editBtn) {
      startEditStockCategory(editBtn.dataset.editStockCategoryId);
      return;
    }

    const deleteBtn = event.target.closest('[data-delete-stock-category-id]');
    if (!deleteBtn) return;

    const categoryId = Number(deleteBtn.dataset.deleteStockCategoryId);
    const categoryName = deleteBtn.dataset.deleteStockCategoryName || '';
    try {
      await withLoading('createStockCategoryBtn', '处理中...', () => deleteStockCategory(categoryId, categoryName), {
        global: true,
        globalText: '正在删除股票分类并刷新看板...',
      });
    } catch (error) {
      showBanner('stockMsg', `分类删除失败: ${error.message}`, true);
    }
  });

  $('openStockSymbolModalBtn')?.addEventListener('click', async () => {
    try {
      await openStockSymbolModal();
    } catch (error) {
      showBanner('stockMsg', `打开股票池失败: ${error.message}`, true);
    }
  });

  $('closeStockSymbolModalBtn')?.addEventListener('click', () => {
    closeStockSymbolModal();
  });

  $('stockSymbolModal')?.addEventListener('click', (event) => {
    if (event.target.id === 'stockSymbolModal') {
      closeStockSymbolModal();
    }
  });

  $('stockBasicsQuickSelect')?.addEventListener('change', (event) => {
    const option = event.currentTarget?.selectedOptions?.[0];
    if (!option || !option.value) return;
    setValue('stockSymbolCodeInput', option.value || '');
    setValue('stockSymbolNameInput', option.dataset?.name || '');
  });

  $('createStockSymbolBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('createStockSymbolBtn', '添加中...', () => createStockSymbol(), {
        global: true,
        globalText: '正在添加股票并刷新监测...',
      });
    } catch (error) {
      showBanner('stockMsg', `股票添加失败: ${error.message}`, true);
    }
  });

  $('stockManageList')?.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-delete-stock-symbol-id]');
    if (!btn) return;
    const symbolId = Number(btn.dataset.deleteStockSymbolId);
    const symbolName = btn.dataset.deleteStockSymbolName || '';
    try {
      await withLoading('createStockSymbolBtn', '处理中...', () => deleteStockSymbol(symbolId, symbolName), {
        global: true,
        globalText: '正在删除股票...',
      });
    } catch (error) {
      showBanner('stockMsg', `删除失败: ${error.message}`, true);
    }
  });

  $('openStockConsoleModalBtn')?.addEventListener('click', () => {
    openStockConsoleModal();
  });

  $('closeStockConsoleModalBtn')?.addEventListener('click', () => {
    closeStockConsoleModal();
  });

  $('stockConsoleModal')?.addEventListener('click', (event) => {
    if (event.target.id === 'stockConsoleModal') {
      closeStockConsoleModal();
    }
  });

  $('refreshStockMonitorBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('refreshStockMonitorBtn', '刷新中...', () => loadStockMonitor(), {
        global: true,
        globalText: '正在拉取股票实时行情...',
      });
    } catch (error) {
      showBanner('stockMsg', `监测刷新失败: ${error.message}`, true);
      setHtml('stockMonitorContainer', `<div class="futures-empty value-down">监测加载失败: ${escapeHtml(error.message)}</div>`);
    }
  });

  $('stockTimeframeSelect')?.addEventListener('change', async () => {
    try {
      const timeframe = $('stockTimeframeSelect')?.value || '1m';
      safeLocalStorageSet('stock.defaultTimeframe', timeframe);
      syncStockKlineStateByTimeframe(timeframe);
      await withLoading('refreshStockMonitorBtn', '刷新中...', () => loadStockMonitor());
    } catch (error) {
      showBanner('stockMsg', `监测刷新失败: ${error.message}`, true);
    }
  });

  $('stockAutoRefreshSelect')?.addEventListener('change', async (event) => {
    const ms = Number(event.currentTarget?.value || 30000);
    updateStockAutoRefresh(ms);
    try {
      await withLoading('refreshStockMonitorBtn', '刷新中...', () => loadStockMonitor({ silent: true }));
      showBanner('stockMsg', `自动刷新已更新：${ms > 0 ? `${Math.round(ms / 1000)}秒` : '关闭'}`);
    } catch (error) {
      showBanner('stockMsg', `自动刷新设置失败: ${error.message}`, true);
    }
  });

  $('stockMonitorContainer')?.addEventListener('click', async (event) => {
    const presetBtn = event.target.closest('[data-stock-kline-preset]');
    if (presetBtn) {
      const preset = presetBtn.dataset.stockKlinePreset || 'minute';
      try {
        await withLoading('refreshStockMonitorBtn', '切换中...', () => switchStockKlinePreset(preset));
        const label = FUTURES_KLINE_PRESET_ITEMS.find((item) => item.key === preset)?.label || preset;
        showBanner('stockMsg', `已切换K线：${label}`);
      } catch (error) {
        showBanner('stockMsg', `切换K线失败: ${error.message}`, true);
      }
      return;
    }

    const btn = event.target.closest('[data-delete-stock-symbol-id]');
    if (!btn) return;
    const symbolId = Number(btn.dataset.deleteStockSymbolId);
    const symbolName = btn.dataset.deleteStockSymbolName || '';
    try {
      await withLoading('refreshStockMonitorBtn', '刷新中...', () => deleteStockSymbol(symbolId, symbolName), {
        global: true,
        globalText: '正在删除股票并刷新监测...',
      });
    } catch (error) {
      showBanner('stockMsg', `删除失败: ${error.message}`, true);
    }
  });

  $('parseTextBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('parseTextBtn', '解析中...', () => parseImportText());
    } catch (error) {
      showBanner('importMsg', `解析失败: ${error.message}`, true);
    }
  });

  $('parseFileBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('parseFileBtn', '解析中...', () => parseImportFile(), {
        global: true,
        globalText: '正在解析文件...',
      });
    } catch (error) {
      showBanner('importMsg', `文件解析失败: ${error.message}`, true);
    }
  });

  $('extractImageBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('extractImageBtn', '提取中...', () => extractImage(), {
        global: true,
        globalText: '正在识别图片内容...',
      });
    } catch (error) {
      showBanner('importMsg', `图片提取失败: ${error.message}`, true);
    }
  });

  $('useImportForAnalysisBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('useImportForAnalysisBtn', '提交中...', () => useImportForAnalysis());
    } catch (error) {
      showBanner('importMsg', `提交失败: ${error.message}`, true);
    }
  });

  $('refreshHistoryBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('refreshHistoryBtn', '刷新中...', () => loadHistory());
    } catch (error) {
      setHtml('historyDetailView', `<div class="value-down">历史加载失败: ${escapeHtml(error.message)}</div>`);
    }
  });

  $('selectAllHistoryBtn')?.addEventListener('click', toggleSelectAllHistory);

  $('deleteHistoryBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('deleteHistoryBtn', '删除中...', () => deleteHistoryBatch());
    } catch (error) {
      setHtml('historyDetailView', `<div class="value-down">删除失败: ${escapeHtml(error.message)}</div>`);
    }
  });

  $('runBacktestBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('runBacktestBtn', '回测中...', () => runBacktest(), {
        global: true,
        globalText: '正在回测历史信号...',
      });
    } catch (error) {
      renderSummaryCards('backtestSummary', [{ label: '回测失败', value: error.message, className: 'value-down' }]);
    }
  });

  $('refreshBacktestBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('refreshBacktestBtn', '刷新中...', () => refreshBacktest());
    } catch (error) {
      renderSummaryCards('backtestSummary', [{ label: '加载失败', value: error.message, className: 'value-down' }]);
    }
  });

  $('sendAgentBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('sendAgentBtn', '发送中...', () => sendAgentMessage(), {
        global: true,
        globalText: '正在生成策略回复...',
      });
    } catch (error) {
      setHtml('agentReplyView', `<div class="value-down">问股失败: ${escapeHtml(error.message)}</div>`);
    }
  });

  $('loadStrategiesBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('loadStrategiesBtn', '刷新中...', () => loadStrategies());
    } catch (error) {
      setHtml('agentReplyView', `<div class="value-down">策略加载失败: ${escapeHtml(error.message)}</div>`);
    }
  });

  $('loadSessionsBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('loadSessionsBtn', '刷新中...', () => loadSessions());
    } catch (error) {
      setHtml('agentReplyView', `<div class="value-down">会话加载失败: ${escapeHtml(error.message)}</div>`);
    }
  });

  $('createAccountBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('createAccountBtn', '创建中...', () => createAccount());
    } catch (error) {
      showBanner('portfolioMsg', `账户创建失败: ${error.message}`, true);
    }
  });

  $('refreshAccountsBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('refreshAccountsBtn', '刷新中...', () => loadAccounts());
    } catch (error) {
      showBanner('portfolioMsg', `账户加载失败: ${error.message}`, true);
    }
  });

  $('createTradeBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('createTradeBtn', '提交中...', () => createTrade());
    } catch (error) {
      showBanner('portfolioMsg', `交易失败: ${error.message}`, true);
    }
  });

  $('loadSnapshotBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('loadSnapshotBtn', '加载中...', () => loadPortfolioView('snapshot'));
    } catch (error) {
      renderSummaryCards('portfolioView', [{ label: '加载失败', value: error.message, className: 'value-down' }]);
    }
  });

  $('loadRiskBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('loadRiskBtn', '加载中...', () => loadPortfolioView('risk'));
    } catch (error) {
      renderSummaryCards('portfolioView', [{ label: '加载失败', value: error.message, className: 'value-down' }]);
    }
  });

  $('loginBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('loginBtn', '登录中...', () => login());
    } catch (error) {
      showBanner('systemMsg', `登录失败: ${error.message}`, true);
    }
  });

  $('logoutBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('logoutBtn', '退出中...', () => logout());
    } catch (error) {
      showBanner('systemMsg', `退出失败: ${error.message}`, true);
    }
  });

  $('enableAuthBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('enableAuthBtn', '启用中...', () => setAuthEnabled(true));
    } catch (error) {
      showBanner('systemMsg', `设置失败: ${error.message}`, true);
    }
  });

  $('disableAuthBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('disableAuthBtn', '关闭中...', () => setAuthEnabled(false));
    } catch (error) {
      showBanner('systemMsg', `设置失败: ${error.message}`, true);
    }
  });

  $('changePwdBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('changePwdBtn', '修改中...', () => changePassword());
    } catch (error) {
      showBanner('systemMsg', `修改失败: ${error.message}`, true);
    }
  });

  $('loadConfigBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('loadConfigBtn', '加载中...', () => loadConfig());
    } catch (error) {
      showBanner('systemMsg', `配置加载失败: ${error.message}`, true);
    }
  });

  $('saveConfigBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('saveConfigBtn', '保存中...', () => saveConfig());
    } catch (error) {
      showBanner('systemMsg', `配置保存失败: ${error.message}`, true);
    }
  });

  $('testEmailBtn')?.addEventListener('click', async () => {
    try {
      await withLoading('testEmailBtn', '发送中...', () => testEmail());
    } catch (error) {
      showBanner('systemMsg', `测试失败: ${error.message}`, true);
    }
  });
}

async function bootstrap() {
  setupTabs();
  setupSidebarGroups();
  setupCommandPalette();
  renderFuturesPresetSelect();
  renderFuturesAutoRefreshSelect();
  renderStockAutoRefreshSelect();
  bindChartHover('priceChart', 'price');
  bindChartHover('volumeChart', 'volume');
  bindChartHover('chipChart', 'chip');
  bindEvents();

  showGlobalLoading('正在初始化页面...');

  try {
    await updateHealth();
    await Promise.all([
      loadTasks(),
      loadQuickMarket(),
      loadMarketReview(),
      loadFuturesTimeframes(),
      loadFuturesPresets(),
      loadFuturesCategories(),
      loadStockMonitorTimeframes(),
      loadStockMonitorCategories(),
      searchStockBasics({ silent: true }),
      loadHistory(),
      refreshBacktest(),
      loadStrategies(),
      loadSessions(),
      loadAccounts(),
      loadAuthStatus(),
      loadConfig(),
    ]);
    await loadFuturesMonitor();
    await loadStockMonitor();
    connectTaskStream();
  } catch (error) {
    showBanner('realtimeMsg', `初始化失败: ${error.message}`, true);
  } finally {
    applyFuturesAutoRefresh({ runNow: !state.futuresMonitor });
    applyStockAutoRefresh({ runNow: !state.stockMonitor });
    hideGlobalLoading();
  }
}

bootstrap();

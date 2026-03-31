const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? JSON_HEADERS : {}),
      ...(options.headers || {}),
    },
    body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${response.status}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

function toQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

export const api = {
  health: () => request('/api/health'),

  analysis: {
    trigger: (payload) => request('/api/v1/analysis', { method: 'POST', body: payload }),
    tasks: (params = {}) => request(`/api/v1/analysis/tasks${toQuery(params)}`),
    taskStatus: (taskId) => request(`/api/v1/analysis/tasks/${taskId}`),
  },

  market: {
    review: (region = 'both') => request(`/api/v1/market/review${toQuery({ region })}`),
  },

  futures: {
    timeframes: () => request('/api/v1/futures/timeframes'),
    presets: (params = {}) => request(`/api/v1/futures/presets${toQuery(params)}`),
    categories: () => request('/api/v1/futures/categories'),
    createCategory: (payload) => request('/api/v1/futures/categories', { method: 'POST', body: payload }),
    updateCategory: (categoryId, payload) => request(`/api/v1/futures/categories/${categoryId}`, { method: 'PUT', body: payload }),
    deleteCategory: (categoryId) => request(`/api/v1/futures/categories/${categoryId}`, { method: 'DELETE' }),
    createSymbol: (payload) => request('/api/v1/futures/symbols', { method: 'POST', body: payload }),
    deleteSymbol: (symbolId) => request(`/api/v1/futures/symbols/${symbolId}`, { method: 'DELETE' }),
    monitor: (params = {}) => request(`/api/v1/futures/monitor${toQuery(params)}`),
  },

  stockBasics: {
    sync: () => request('/api/v1/stock-basics/sync', { method: 'POST' }),
    search: (params = {}) => request(`/api/v1/stock-basics${toQuery(params)}`),
    detail: (code, params = {}) => request(`/api/v1/stock-basics/${encodeURIComponent(code)}${toQuery(params)}`),
  },

  stockMonitor: {
    timeframes: () => request('/api/v1/stock-monitor/timeframes'),
    categories: () => request('/api/v1/stock-monitor/categories'),
    createCategory: (payload) => request('/api/v1/stock-monitor/categories', { method: 'POST', body: payload }),
    updateCategory: (categoryId, payload) => request(`/api/v1/stock-monitor/categories/${categoryId}`, { method: 'PUT', body: payload }),
    deleteCategory: (categoryId) => request(`/api/v1/stock-monitor/categories/${categoryId}`, { method: 'DELETE' }),
    createSymbol: (payload) => request('/api/v1/stock-monitor/symbols', { method: 'POST', body: payload }),
    deleteSymbol: (symbolId) => request(`/api/v1/stock-monitor/symbols/${symbolId}`, { method: 'DELETE' }),
    monitor: (params = {}) => request(`/api/v1/stock-monitor/monitor${toQuery(params)}`),
  },

  stocks: {
    quote: (stockCode) => request(`/api/v1/stocks/${encodeURIComponent(stockCode)}/quote`),
    history: (stockCode, days = 180) => request(`/api/v1/stocks/${encodeURIComponent(stockCode)}/history${toQuery({ days })}`),
    parseImportText: (text) => request('/api/v1/stocks/parse-import', { method: 'POST', body: { text } }),
    parseImportFile: (file) => {
      const form = new FormData();
      form.append('file', file);
      return request('/api/v1/stocks/parse-import', { method: 'POST', body: form });
    },
    extractFromImage: (file) => {
      const form = new FormData();
      form.append('file', file);
      return request('/api/v1/stocks/extract-from-image', { method: 'POST', body: form });
    },
  },

  history: {
    list: (params = {}) => request(`/api/v1/history${toQuery(params)}`),
    detail: (id) => request(`/api/v1/history/${id}`),
    deleteBatch: (recordIds) => request('/api/v1/history', { method: 'DELETE', body: { recordIds } }),
  },

  backtest: {
    run: (payload) => request('/api/v1/backtest/run', { method: 'POST', body: payload }),
    overall: (evaluationDays = 5) => request(`/api/v1/backtest/overall-performance${toQuery({ evaluationDays })}`),
    byStock: (evaluationDays = 5) => request(`/api/v1/backtest/stock-performance${toQuery({ evaluationDays })}`),
  },

  agent: {
    strategies: () => request('/api/v1/agent/strategies'),
    chat: (payload) => request('/api/v1/agent/chat', { method: 'POST', body: payload }),
    sessions: () => request('/api/v1/agent/chat/sessions'),
    sessionMessages: (sessionId) => request(`/api/v1/agent/chat/sessions/${sessionId}`),
  },

  portfolio: {
    accounts: () => request('/api/v1/portfolio/accounts'),
    createAccount: (payload) => request('/api/v1/portfolio/accounts', { method: 'POST', body: payload }),
    createTrade: (payload) => request('/api/v1/portfolio/trades', { method: 'POST', body: payload }),
    snapshot: (accountId) => request(`/api/v1/portfolio/snapshot${toQuery({ accountId })}`),
    riskReport: (accountId) => request(`/api/v1/portfolio/risk-report${toQuery({ accountId })}`),
  },

  auth: {
    status: () => request('/api/v1/auth/status'),
    login: (payload) => request('/api/v1/auth/login', { method: 'POST', body: payload }),
    logout: () => request('/api/v1/auth/logout', { method: 'POST' }),
    updateSettings: (payload) => request('/api/v1/auth/settings', { method: 'POST', body: payload }),
    changePassword: (payload) => request('/api/v1/auth/change-password', { method: 'POST', body: payload }),
  },

  system: {
    config: () => request('/api/v1/system/config'),
    updateConfig: (payload) => request('/api/v1/system/config', { method: 'PUT', body: payload }),
    testEmail: () => request('/api/v1/system/test-email', { method: 'POST' }),
  },
};

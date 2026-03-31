async function request(path, init = {}) {
  const timeoutMs = Number(init.timeoutMs) > 0 ? Number(init.timeoutMs) : 20000;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(path, {
      ...init,
      signal: init.signal || controller.signal,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(json?.message || `HTTP ${response.status}`);
    }
    return json;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('请求超时，请稍后重试');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function stockMonitorRequest(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  });
  return request(`/api/v1/stock-monitor/monitor?${search.toString()}`);
}

stockMonitorRequest.categories = () => request('/api/v1/stock-monitor/categories');
stockMonitorRequest.timeframes = () => request('/api/v1/stock-monitor/timeframes');
stockMonitorRequest.createCategory = (payload) =>
  request('/api/v1/stock-monitor/categories', { method: 'POST', body: JSON.stringify(payload) });
stockMonitorRequest.updateCategory = (categoryId, payload) =>
  request(`/api/v1/stock-monitor/categories/${encodeURIComponent(categoryId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
stockMonitorRequest.deleteCategory = (categoryId) =>
  request(`/api/v1/stock-monitor/categories/${encodeURIComponent(categoryId)}`, {
    method: 'DELETE',
  });
stockMonitorRequest.moveCategory = (categoryId, payload = {}) =>
  request(`/api/v1/stock-monitor/categories/${encodeURIComponent(categoryId)}/move`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
stockMonitorRequest.createSymbol = (payload) =>
  request('/api/v1/stock-monitor/symbols', { method: 'POST', body: JSON.stringify(payload) });
stockMonitorRequest.moveSymbol = (symbolId, payload = {}) =>
  request(`/api/v1/stock-monitor/symbols/${encodeURIComponent(symbolId)}/move`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
stockMonitorRequest.deleteSymbol = (symbolId) =>
  request(`/api/v1/stock-monitor/symbols/${encodeURIComponent(symbolId)}`, {
    method: 'DELETE',
  });

function focusNewsRequest(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  });
  return request(`/api/v1/focus-news/items${search.toString() ? `?${search.toString()}` : ''}`);
}

focusNewsRequest.providers = () => request('/api/v1/focus-news/providers');
focusNewsRequest.categories = (params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  return request(`/api/v1/focus-news/categories${search.toString() ? `?${search.toString()}` : ''}`);
};
focusNewsRequest.taxonomies = () => request('/api/v1/focus-news/taxonomies');
focusNewsRequest.mappings = (params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  return request(`/api/v1/focus-news/mappings${search.toString() ? `?${search.toString()}` : ''}`);
};
focusNewsRequest.syncRuns = (params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  return request(`/api/v1/focus-news/sync/runs${search.toString() ? `?${search.toString()}` : ''}`);
};
focusNewsRequest.schedulerStatus = (params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  return request(`/api/v1/focus-news/scheduler/status${search.toString() ? `?${search.toString()}` : ''}`);
};
focusNewsRequest.schedulerCategories = (params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  return request(`/api/v1/focus-news/scheduler/categories${search.toString() ? `?${search.toString()}` : ''}`);
};
focusNewsRequest.syncCatalog = (payload = {}) =>
  request('/api/v1/focus-news/sync/catalog', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
focusNewsRequest.syncItems = (payload = {}) =>
  request('/api/v1/focus-news/sync/items', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
focusNewsRequest.itemDetail = (newsUid, params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const suffix = search.toString() ? `?${search.toString()}` : '';
  return request(`/api/v1/focus-news/items/${encodeURIComponent(newsUid)}${suffix}`);
};
focusNewsRequest.schedulerRun = (payload = {}) =>
  request('/api/v1/focus-news/scheduler/run', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
focusNewsRequest.schedulerCategoryPolicy = (categoryKey, payload = {}) =>
  request(`/api/v1/focus-news/scheduler/categories/${encodeURIComponent(categoryKey)}/policy`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });

export const clientApi = {
  futures: {
    timeframes: () => request('/api/v1/futures/timeframes'),
    presets: (params = {}) => {
      const search = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          search.set(key, String(value));
        }
      });
      return request(`/api/v1/futures/presets${search.toString() ? `?${search.toString()}` : ''}`);
    },
    resolve: (params = {}) => {
      const search = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          search.set(key, String(value));
        }
      });
      return request(`/api/v1/futures/resolve${search.toString() ? `?${search.toString()}` : ''}`);
    },
    categories: () => request('/api/v1/futures/categories'),
    createCategory: (payload) => request('/api/v1/futures/categories', { method: 'POST', body: JSON.stringify(payload) }),
    updateCategory: (categoryId, payload) =>
      request(`/api/v1/futures/categories/${encodeURIComponent(categoryId)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    deleteCategory: (categoryId) =>
      request(`/api/v1/futures/categories/${encodeURIComponent(categoryId)}`, {
        method: 'DELETE',
      }),
    createSymbol: (payload) => request('/api/v1/futures/symbols', { method: 'POST', body: JSON.stringify(payload) }),
    deleteSymbol: (symbolId) =>
      request(`/api/v1/futures/symbols/${encodeURIComponent(symbolId)}`, {
        method: 'DELETE',
      }),
    monitor: (params = {}) => {
      const search = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          search.set(key, String(value));
        }
      });
      return request(`/api/v1/futures/monitor?${search.toString()}`);
    },
  },
  stockMonitor: stockMonitorRequest,
  focusNews: focusNewsRequest,
  analysisTasks: (limit = 20) => request(`/api/v1/analysis/tasks?limit=${limit}`),
  parseImportText: (text) => request('/api/v1/stocks/parse-import', { method: 'POST', body: JSON.stringify({ text }) }),
  parseImportFile: (file) => {
    const form = new FormData();
    form.append('file', file);
    return fetch('/api/v1/stocks/parse-import', {
      method: 'POST',
      body: form,
      credentials: 'include',
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || `HTTP ${response.status}`);
      return payload;
    });
  },
  extractFromImage: (file) => {
    const form = new FormData();
    form.append('file', file);
    return fetch('/api/v1/stocks/extract-from-image', {
      method: 'POST',
      body: form,
      credentials: 'include',
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || `HTTP ${response.status}`);
      return payload;
    });
  },
  agent: {
    strategies: () => request('/api/v1/agent/strategies'),
    chat: (payload) => request('/api/v1/agent/chat', { method: 'POST', body: JSON.stringify(payload) }),
    sessions: () => request('/api/v1/agent/chat/sessions'),
    sessionMessages: (sessionId) => request(`/api/v1/agent/chat/sessions/${encodeURIComponent(sessionId)}`),
  },
  portfolio: {
    accounts: () => request('/api/v1/portfolio/accounts'),
    createAccount: (payload) => request('/api/v1/portfolio/accounts', { method: 'POST', body: JSON.stringify(payload) }),
    createTrade: (payload) => request('/api/v1/portfolio/trades', { method: 'POST', body: JSON.stringify(payload) }),
    snapshot: (accountId) =>
      request(`/api/v1/portfolio/snapshot${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`),
    riskReport: (accountId) =>
      request(`/api/v1/portfolio/risk-report${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`),
  },
  stockBasics: {
    sync: () => request('/api/v1/stock-basics/sync', { method: 'POST' }),
    search: (params = {}) => {
      const search = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
      });
      return request(`/api/v1/stock-basics?${search.toString()}`);
    },
    suggest: (params = {}) => {
      const search = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
      });
      return request(`/api/v1/stock-basics/suggest?${search.toString()}`);
    },
    detail: (code, market = '', options = {}) => {
      const search = new URLSearchParams();
      if (market) search.set('market', market);
      if (options.localOnly === true) search.set('localOnly', '1');
      if (options.localOnly === false) search.set('localOnly', '0');
      return request(`/api/v1/stock-basics/${encodeURIComponent(code)}${search.toString() ? `?${search.toString()}` : ''}`);
    },
  },
  system: {
    getConfig: (params = {}) => {
      const search = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
      });
      return request(`/api/v1/system/config${search.toString() ? `?${search.toString()}` : ''}`);
    },
    updateConfig: (payload = {}) =>
      request('/api/v1/system/config', {
        method: 'PUT',
        body: JSON.stringify(payload || {}),
      }),
    marketData: (params = {}) => {
      const search = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
      });
      return request(`/api/v1/system/market-data?${search.toString()}`);
    },
    syncMarketData: (payload) =>
      request('/api/v1/system/market-data/sync', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      }),
  },
};

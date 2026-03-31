const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || 'http://127.0.0.1:8889';

async function request(path, init = {}, nextOptions = {}) {
  const response = await fetch(`${BACKEND_ORIGIN}${path}`, {
    ...init,
    cache: nextOptions.cache || 'no-store',
    next: nextOptions.next,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = json?.message || `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return json;
}

export async function getMarketReview(region = 'both') {
  return request(`/api/v1/market/review?region=${encodeURIComponent(region)}`);
}

export async function getStockBasicsDetail(code, market = '') {
  const q = market ? `?market=${encodeURIComponent(market)}` : '';
  return request(`/api/v1/stock-basics/${encodeURIComponent(code)}${q}`);
}

export async function getStockHistory(code, days = 180) {
  return request(`/api/v1/stocks/${encodeURIComponent(code)}/history?days=${days}`);
}

export async function getStockQuote(code) {
  return request(`/api/v1/stocks/${encodeURIComponent(code)}/quote`);
}

export async function getAnalysisTasks(limit = 20) {
  const payload = await request(`/api/v1/analysis/tasks?limit=${limit}`);
  return payload?.items || [];
}

export async function getStockMonitor(timeframe = '30s', limit = 120) {
  return request(`/api/v1/stock-monitor/monitor?timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`);
}

export async function searchStockBasics({ q = '', market = '', page = 1, limit = 200 } = {}) {
  const query = new URLSearchParams({
    q,
    market,
    page: String(page),
    limit: String(limit),
  });
  return request(`/api/v1/stock-basics?${query.toString()}`);
}

export async function triggerAnalysisServer(payload) {
  return request('/api/v1/analysis', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getFuturesMonitor(timeframe = '60m', limit = 120) {
  return request(`/api/v1/futures/monitor?timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`);
}

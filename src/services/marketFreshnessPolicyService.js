const INTRADAY_TFS = new Set(['30s', '1m', '5m', '15m', '30m', '60m']);

function toMsFromTradeDay(dayText = '') {
  const text = String(dayText || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const ms = Date.parse(`${text}T00:00:00+08:00`);
  return Number.isFinite(ms) ? ms : null;
}

export const marketFreshnessPolicyService = {
  evaluate({ timeframe = '1d', latestBucketTs = null, latestTradeDay = '', nowMs = Date.now() } = {}) {
    if (!latestBucketTs && !latestTradeDay) {
      return {
        freshness: 'missing',
        reason: 'no_data',
        ageSeconds: null,
      };
    }

    const tf = String(timeframe || '').trim();

    if (INTRADAY_TFS.has(tf)) {
      const tsMs = Number(latestBucketTs) * 1000;
      if (!Number.isFinite(tsMs)) {
        return {
          freshness: 'missing',
          reason: 'invalid_intraday_ts',
          ageSeconds: null,
        };
      }
      const ageSeconds = Math.max(Math.floor((nowMs - tsMs) / 1000), 0);
      const freshThreshold = 3 * 60;
      const usableThreshold = 30 * 60;
      if (ageSeconds <= freshThreshold) {
        return { freshness: 'fresh', reason: 'intraday_fresh', ageSeconds };
      }
      if (ageSeconds <= usableThreshold) {
        return { freshness: 'stale_but_usable', reason: 'intraday_stale', ageSeconds };
      }
      return { freshness: 'missing', reason: 'intraday_expired', ageSeconds };
    }

    const dayMs = toMsFromTradeDay(latestTradeDay);
    if (!Number.isFinite(dayMs)) {
      return {
        freshness: 'missing',
        reason: 'invalid_trade_day',
        ageSeconds: null,
      };
    }
    const ageDays = Math.max((nowMs - dayMs) / (24 * 3600 * 1000), 0);
    if (ageDays <= 2.2) {
      return { freshness: 'fresh', reason: 'eod_fresh', ageSeconds: Math.floor(ageDays * 86400) };
    }
    if (ageDays <= 7.2) {
      return { freshness: 'stale_but_usable', reason: 'eod_stale', ageSeconds: Math.floor(ageDays * 86400) };
    }
    return { freshness: 'missing', reason: 'eod_expired', ageSeconds: Math.floor(ageDays * 86400) };
  },
};

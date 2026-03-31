export function num(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(digits);
}

export function signed(value, digits = 2, suffix = '') {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  const text = n.toFixed(digits);
  return `${n > 0 ? '+' : ''}${text}${suffix}`;
}

export function compact(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  if (Math.abs(n) >= 100000000) return `${(n / 100000000).toFixed(2)}亿`;
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(2)}万`;
  return Math.round(n).toLocaleString();
}

export function toCandles(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const dateText = String(item.date || '').trim();
      const time = Date.parse(dateText.includes('T') ? dateText : dateText.replace(' ', 'T'));
      if (!Number.isFinite(time)) return null;
      const open = Number(item.open);
      const high = Number(item.high);
      const low = Number(item.low);
      const close = Number(item.close);
      const volume = Number(item.volume || 0);
      if (![open, high, low, close].every(Number.isFinite)) return null;
      return {
        time: Math.floor(time / 1000),
        open,
        high,
        low,
        close,
        value: volume,
      };
    })
    .filter(Boolean);
}

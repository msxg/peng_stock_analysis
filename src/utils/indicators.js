export function movingAverage(series, period) {
  if (!Array.isArray(series) || period <= 0) return [];
  return series.map((_, index) => {
    if (index + 1 < period) return null;
    const window = series.slice(index + 1 - period, index + 1);
    const sum = window.reduce((acc, item) => acc + Number(item || 0), 0);
    return Number((sum / period).toFixed(4));
  });
}

export function pctChange(current, prev) {
  if (!prev || !Number.isFinite(current) || !Number.isFinite(prev)) return 0;
  return Number((((current - prev) / prev) * 100).toFixed(2));
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function calcBias(close, ma) {
  if (!ma) return 0;
  return Number((((close - ma) / ma) * 100).toFixed(2));
}

export function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function average(values) {
  if (!values.length) return 0;
  const total = values.reduce((sum, current) => sum + safeNumber(current), 0);
  return total / values.length;
}

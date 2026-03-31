'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const INTRADAY_KEYS = new Set(['30s', '1m', '5m', '15m', '30m', '60m']);
const LONG_KEYS = new Set(['1d', '1w', '1M']);
const PRICE_RENDER_POINT_LIMIT = 480;
const VOLUME_RENDER_POINT_LIMIT = 360;

function safeNum(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(digits);
}

function compactNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  if (Math.abs(n) >= 100000000) return `${(n / 100000000).toFixed(2)}亿`;
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(2)}万`;
  return Math.round(n).toLocaleString();
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
    return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss || 0), 0).getTime();
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatTimeAxisLabel(value = '') {
  const text = String(value || '').trim();
  if (!text) return '-';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.slice(5);
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(text)) return text.slice(11, 16);
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(text)) return text.slice(11, 16);
  return text;
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

function toFiniteNumber(value) {
  if (Number.isFinite(value)) return Number(value);
  if (typeof value === 'string') {
    const num = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(num) ? num : Number.NaN;
  }
  return Number.NaN;
}

function hasDrawableCandles(candles = [], timeframe = '') {
  if (!Array.isArray(candles) || !candles.length) return false;
  const tf = String(timeframe || '');
  const isLong = LONG_KEYS.has(tf);
  let valid = 0;
  for (const item of candles) {
    const close = toFiniteNumber(item?.close);
    if (Number.isFinite(close)) valid += 1;
    if (isLong && valid >= 1) return true;
    if (valid >= 8) return true;
  }
  if (isLong) return valid >= 1;
  return valid >= Math.max(3, Math.floor(candles.length * 0.2));
}

function compactCandlesForRender(candles = [], timeframe = '', maxPoints = 480) {
  const source = Array.isArray(candles) ? candles : [];
  const limit = Number(maxPoints);
  if (!source.length || !Number.isFinite(limit) || limit < 20 || source.length <= limit) {
    return source;
  }
  if (!INTRADAY_KEYS.has(String(timeframe || ''))) {
    return source.slice(-limit);
  }

  const bucketSize = Math.ceil(source.length / limit);
  const compacted = [];

  for (let i = 0; i < source.length; i += bucketSize) {
    const chunk = source.slice(i, i + bucketSize);
    if (!chunk.length) continue;
    const first = chunk[0] || {};
    const last = chunk[chunk.length - 1] || first;
    let close = Number.NaN;
    for (let j = chunk.length - 1; j >= 0; j -= 1) {
      const c = toFiniteNumber(chunk[j]?.close);
      if (Number.isFinite(c)) {
        close = c;
        break;
      }
    }
    if (!Number.isFinite(close)) {
      for (let j = chunk.length - 1; j >= 0; j -= 1) {
        const c = toFiniteNumber(chunk[j]?.open);
        if (Number.isFinite(c)) {
          close = c;
          break;
        }
      }
    }
    if (!Number.isFinite(close)) continue;

    let open = Number.NaN;
    for (let j = 0; j < chunk.length; j += 1) {
      const o = toFiniteNumber(chunk[j]?.open);
      if (Number.isFinite(o)) {
        open = o;
        break;
      }
    }
    if (!Number.isFinite(open)) {
      for (let j = 0; j < chunk.length; j += 1) {
        const c = toFiniteNumber(chunk[j]?.close);
        if (Number.isFinite(c)) {
          open = c;
          break;
        }
      }
    }
    if (!Number.isFinite(open)) open = close;

    let high = Number.NEGATIVE_INFINITY;
    let low = Number.POSITIVE_INFINITY;
    let volume = 0;
    let amount = 0;

    chunk.forEach((item) => {
      const h = toFiniteNumber(item?.high);
      const l = toFiniteNumber(item?.low);
      const c = toFiniteNumber(item?.close);
      const candidateHigh = Number.isFinite(h) ? h : c;
      const candidateLow = Number.isFinite(l) ? l : c;
      if (Number.isFinite(candidateHigh)) high = Math.max(high, candidateHigh);
      if (Number.isFinite(candidateLow)) low = Math.min(low, candidateLow);
      const v = toFiniteNumber(item?.volume);
      if (Number.isFinite(v)) volume += v;
      const a = toFiniteNumber(item?.amount);
      if (Number.isFinite(a)) amount += a;
    });

    const highSafe = Number.isFinite(high) ? high : Math.max(open, close);
    const lowSafe = Number.isFinite(low) ? low : Math.min(open, close);
    compacted.push({
      date: last.date || first.date,
      open,
      high: highSafe,
      low: lowSafe,
      close,
      volume,
      amount,
    });
  }

  return compacted;
}

function getXAxis(candles = [], timeframe = '', area = { x: 0, w: 1 }) {
  const count = candles.length;
  const pointByIndex = (idx) => area.x + (idx / Math.max(count - 1, 1)) * area.w;
  const labelIndexes = Array.from(new Set([0, Math.floor((count - 1) * 0.33), Math.floor((count - 1) * 0.66), count - 1])).filter(
    (idx) => idx >= 0 && idx < count,
  );

  const fallback = {
    pointXByIndex: pointByIndex,
    tickLabels: labelIndexes.map((idx) => ({
      x: pointByIndex(idx),
      label: formatTimeAxisLabel(candles[idx]?.date),
    })),
  };

  if (!count || !INTRADAY_KEYS.has(String(timeframe || ''))) {
    return fallback;
  }

  const tsList = candles.map((item) => parseCandleDateToMs(item?.date));
  if (tsList.some((ts) => !Number.isFinite(ts))) {
    return fallback;
  }

  const diffs = [];
  for (let i = 1; i < tsList.length; i += 1) {
    const diff = tsList[i] - tsList[i - 1];
    if (!Number.isFinite(diff) || diff <= 0) {
      return fallback;
    }
    diffs.push(diff);
  }
  if (!diffs.length) {
    return fallback;
  }

  const sortedDiffs = [...diffs].sort((a, b) => a - b);
  const medianDiff = sortedDiffs[Math.floor(sortedDiffs.length / 2)] || 0;
  if (!Number.isFinite(medianDiff) || medianDiff <= 0) {
    return fallback;
  }

  const startMs = tsList[0];
  const endMs = tsList[tsList.length - 1];
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return fallback;
  }

  const totalSpan = endMs - startMs;
  const expectedSpan = medianDiff * Math.max(tsList.length - 1, 1);
  const spanRatio = totalSpan / Math.max(expectedSpan, 1);
  const headGap = diffs[0];
  const tailGap = diffs[diffs.length - 1];
  const edgeGapOutlier = Math.max(headGap, tailGap) > medianDiff * 8;
  if (!Number.isFinite(spanRatio) || spanRatio < 0.55 || spanRatio > 1.8 || edgeGapOutlier) {
    return fallback;
  }

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

function drawCanvas(canvas, renderFn) {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(280, Math.floor(rect.width));
  const height = Number(canvas.dataset.logicalHeight) || 260;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  try {
    renderFn(ctx, width, height);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[futures-canvas] draw failed', error);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#b91c1c';
    ctx.font = '13px sans-serif';
    ctx.fillText(`Chart draw failed: ${String(error?.message || 'unknown')}`, 12, 20);
  }
}

/**
 * Draw price chart and return metadata for crosshair overlay.
 * Returns { area, min, max, span, points, rows } or null.
 */
function drawPriceChart(canvas, candles = [], prevClose = null, timeframe = '') {
  let meta = null;
  drawCanvas(canvas, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    if (!candles.length) {
      ctx.fillStyle = '#7d8cab';
      ctx.fillText('No price data', 14, 20);
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
        return { date: item.date, open, high, low, close };
      })
      .filter(Boolean);

    if (!rows.length) {
      ctx.fillStyle = '#7d8cab';
      ctx.fillText('No valid price data', 14, 20);
      return;
    }

    const pad = { left: 4, right: 4, top: 4, bottom: 24 };
    const area = { x: pad.left, y: pad.top, w: w - pad.left - pad.right, h: h - pad.top - pad.bottom };
    drawGrid(ctx, area, 4, 6);

    const closes = rows.map((item) => item.close);
    const highs = rows.map((item) => item.high);
    const lows = rows.map((item) => item.low);
    const ma5 = calcMovingAverage(closes, 5);
    const ma10 = calcMovingAverage(closes, 10);
    const ma20 = calcMovingAverage(closes, 20);
    const isLong = LONG_KEYS.has(String(timeframe || ''));
    const isIntraday = !isLong;
    const prevCloseNum = Number(prevClose);
    const hasPrevClose = Number.isFinite(prevCloseNum) && prevCloseNum > 0;

    // ---- Y-axis range calculation ----
    let min, max;
    if (isIntraday && hasPrevClose) {
      // Center prevClose vertically: symmetric range around it
      const dataMin = Math.min(...closes);
      const dataMax = Math.max(...closes);
      const maExt = [...ma5, ...ma10, ...ma20].filter((v) => Number.isFinite(v));
      const allMin = Math.min(dataMin, ...(maExt.length ? maExt : [dataMin]));
      const allMax = Math.max(dataMax, ...(maExt.length ? maExt : [dataMax]));
      const halfSpan = Math.max(Math.abs(allMax - prevCloseNum), Math.abs(allMin - prevCloseNum), 0.005);
      // Add 5% padding so the extremes don't touch the edge
      const paddedHalf = halfSpan * 1.05;
      min = prevCloseNum - paddedHalf;
      max = prevCloseNum + paddedHalf;
    } else {
      const minBase = Math.min(...(isLong ? lows : closes));
      const maxBase = Math.max(...(isLong ? highs : closes));
      const maExt = [...ma5, ...ma10, ...ma20].filter((v) => Number.isFinite(v));
      min = Math.min(minBase, ...(maExt.length ? maExt : [minBase]));
      max = Math.max(maxBase, ...(maExt.length ? maExt : [maxBase]));
    }
    const span = Math.max(max - min, 0.01);

    const xAxis = getXAxis(rows, timeframe, area);
    const points = rows.map((item, idx) => ({
      x: xAxis.pointXByIndex(idx),
      y: area.y + ((max - Number(item.close || 0)) / span) * area.h,
      close: item.close,
      open: item.open,
      high: item.high,
      low: item.low,
      date: item.date,
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

    if (isLong) {
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

    const axisTicks = Array.isArray(xAxis.tickLabels) && xAxis.tickLabels.length ? xAxis.tickLabels : [];
    ctx.strokeStyle = 'rgba(96, 116, 152, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(area.x, area.y + area.h + 0.5);
    ctx.lineTo(area.x + area.w, area.y + area.h + 0.5);
    ctx.stroke();

    ctx.font = '12px sans-serif';
    axisTicks.forEach((tick) => {
      if (!tick) return;
      const label = tick.label || '-';
      const textW = ctx.measureText(label).width;
      const tx = Math.max(area.x, Math.min(area.x + area.w - textW, tick.x - textW / 2));
      const ty = h - 10;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(tx - 3, ty - 11, textW + 6, 14);
      ctx.fillStyle = '#4f6286';
      ctx.fillText(label, tx, ty);
    });

    if (hasPrevClose) {
      const rawY = area.y + ((max - prevCloseNum) / span) * area.h;
      const baseY = Math.max(area.y + 1, Math.min(area.y + area.h - 1, rawY));
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.moveTo(area.x, baseY);
      ctx.lineTo(area.x + area.w, baseY);
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = '#ef4444';
      ctx.stroke();
      ctx.setLineDash([]);

      const baseLabel = `昨收 ${safeNum(prevCloseNum)}`;
      const lw = ctx.measureText(baseLabel).width + 10;
      ctx.fillStyle = 'rgba(239, 68, 68, 0.16)';
      ctx.fillRect(area.x + area.w - lw, Math.max(area.y + 2, baseY - 14), lw, 16);
      ctx.fillStyle = '#b91c1c';
      ctx.font = '11px sans-serif';
      ctx.fillText(baseLabel, area.x + area.w - lw + 5, Math.max(area.y + 14, baseY - 2));
    }

    // Store metadata for crosshair
    meta = { area, min, max, span, points, w, h, prevClose: hasPrevClose ? prevCloseNum : null };
  });
  return meta;
}

/**
 * Draw crosshair overlay on a separate canvas.
 * mouseX/mouseY are in CSS pixel coordinates relative to the canvas.
 */
function drawCrosshair(overlayCanvas, meta, mouseX, mouseY) {
  if (!overlayCanvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = meta.w;
  const h = meta.h;
  overlayCanvas.width = Math.floor(w * dpr);
  overlayCanvas.height = Math.floor(h * dpr);

  const ctx = overlayCanvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const { area, min, max, span, points } = meta;
  // Check if mouse is within the drawing area horizontally
  if (mouseX < area.x || mouseX > area.x + area.w) {
    return;
  }

  // Find nearest data point by x
  let nearestIdx = 0;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i += 1) {
    const dist = Math.abs(points[i].x - mouseX);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestIdx = i;
    }
  }
  const nearestPoint = points[nearestIdx];
  if (!nearestPoint) return;

  // Snap Y to the nearest data point's close price
  const snapY = nearestPoint.y;

  // Vertical line (follows mouse X)
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = 'rgba(100, 116, 152, 0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mouseX, area.y);
  ctx.lineTo(mouseX, area.y + area.h);
  ctx.stroke();

  // Horizontal line (snapped to data point price)
  ctx.beginPath();
  ctx.moveTo(area.x, snapY);
  ctx.lineTo(area.x + area.w, snapY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Price label on Y axis (left side) - show nearest point's close price + percentage
  const pc = meta.prevClose;
  let priceLabel = safeNum(nearestPoint.close);
  if (Number.isFinite(pc) && pc > 0) {
    const pct = ((nearestPoint.close - pc) / pc) * 100;
    priceLabel += ` | ${pct >= 0 ? '+' : '-'}${Math.abs(pct).toFixed(2)}%`;
  }
  ctx.font = '11px sans-serif';
  const priceLabelW = ctx.measureText(priceLabel).width + 8;
  const labelH = 16;
  const labelY = Math.max(area.y, Math.min(area.y + area.h - labelH, snapY - labelH / 2));
  ctx.fillStyle = 'rgba(70, 95, 160, 0.9)';
  ctx.fillRect(0, labelY, priceLabelW, labelH);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(priceLabel, 4, labelY + 12);

  // Time label on X axis (bottom)
  const timeLabel = formatTimeAxisLabel(nearestPoint.date);
  const timeLabelW = ctx.measureText(timeLabel).width + 8;
  const timeLabelX = Math.max(area.x, Math.min(area.x + area.w - timeLabelW, mouseX - timeLabelW / 2));
  const timeLabelY = area.y + area.h + 1;
  ctx.fillStyle = 'rgba(70, 95, 160, 0.9)';
  ctx.fillRect(timeLabelX, timeLabelY, timeLabelW, labelH);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(timeLabel, timeLabelX + 4, timeLabelY + 12);
}

function drawVolumeChart(canvas, candles = [], timeframe = '') {
  drawCanvas(canvas, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    if (!candles.length) {
      ctx.fillStyle = '#7d8cab';
      ctx.fillText('No volume data', 14, 20);
      return;
    }

    const pad = { left: 4, right: 4, top: 14, bottom: 4 };
    const area = { x: pad.left, y: pad.top, w: w - pad.left - pad.right, h: h - pad.top - pad.bottom };
    drawGrid(ctx, area, 4, 6);

    const maxVolume = Math.max(...candles.map((item) => Number(item.volume || 0)), 1);
    const xAxis = getXAxis(candles, timeframe, area);
    const xCenters = candles.map((_, idx) => xAxis.pointXByIndex(idx));
    let minStep = Number.POSITIVE_INFINITY;
    for (let i = 1; i < xCenters.length; i += 1) {
      const step = xCenters[i] - xCenters[i - 1];
      if (step > 0 && step < minStep) minStep = step;
    }
    const approxStep = Number.isFinite(minStep) ? minStep : area.w / Math.max(candles.length, 1);
    const barWidth = Math.max(2.2, Math.min(8, approxStep * 0.72));

    candles.forEach((item, idx) => {
      const volume = Number(item.volume || 0);
      const close = Number(item.close || 0);
      const prevClose = idx > 0 ? Number(candles[idx - 1]?.close || close) : close;
      const barH = (volume / maxVolume) * area.h;
      const x = Math.max(area.x, Math.min(area.x + area.w - barWidth, xCenters[idx] - barWidth / 2));
      const y = area.y + area.h - barH;
      const rising = close >= prevClose;
      ctx.fillStyle = rising ? 'rgba(220, 38, 38, 0.72)' : 'rgba(22, 163, 74, 0.72)';
      ctx.fillRect(x, y, barWidth, barH);
    });

    const volLabel = `MAX ${compactNumber(maxVolume)}`;
    ctx.font = '11px monospace';
    const volLabelW = ctx.measureText(volLabel).width + 8;
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillRect(area.x + 2, area.y + 1, volLabelW, 14);
    ctx.fillStyle = '#7d8cab';
    ctx.fillText(volLabel, area.x + 6, area.y + 12);
  });
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function FuturesPriceCanvas({ candles = [], timeframe = '30s', prevClose = null, height = 220 }) {
  const ref = useRef(null);
  const overlayRef = useRef(null);
  const metaRef = useRef(null);
  const lastGoodCandlesRef = useRef([]);
  const lastGoodTimeframeRef = useRef(timeframe);
  const zoomLevelRef = useRef(1);
  const scrollOffsetRef = useRef(0);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartOffsetRef = useRef(0);
  const redrawRef = useRef(null);
  const allCandlesRef = useRef([]);
  const renderCandles = useMemo(
    () => compactCandlesForRender(candles, timeframe, PRICE_RENDER_POINT_LIMIT),
    [candles, timeframe],
  );

  // Compute stats – will be recalculated on zoom via statsVersionRef
  const [statsVersion, setStatsVersion] = useState(0);
  const statsVersionRef = useRef(0);
  const computeStats = useCallback((source) => {
    if (!source || !source.length) return null;
    const closes = source.map((c) => Number(c.close)).filter(Number.isFinite);
    if (!closes.length) return null;
    const pc = Number(prevClose);
    const hasPc = Number.isFinite(pc) && pc > 0;
    let min, max;
    if (hasPc) {
      const halfSpan = Math.max(Math.abs(Math.max(...closes) - pc), Math.abs(Math.min(...closes) - pc), 0.005) * 1.05;
      min = pc - halfSpan;
      max = pc + halfSpan;
    } else {
      min = Math.min(...closes);
      max = Math.max(...closes);
    }
    const maxPct = hasPc ? ((max - pc) / pc) * 100 : null;
    const minPct = hasPc ? ((min - pc) / pc) * 100 : null;
    return { min, max, maxPct, minPct };
  }, [prevClose]);

  const stats = useMemo(() => {
    void statsVersion; // dependency to trigger recalc on zoom
    const all = allCandlesRef.current;
    if (!all || !all.length) {
      const source = renderCandles.length ? renderCandles : lastGoodCandlesRef.current;
      return computeStats(source);
    }
    const totalPoints = all.length;
    const visibleCount = Math.max(20, Math.floor(totalPoints / zoomLevelRef.current));
    const maxOff = Math.max(0, totalPoints - visibleCount);
    const startIdx = Math.round(clamp(scrollOffsetRef.current, 0, maxOff));
    const visible = all.slice(startIdx, startIdx + visibleCount);
    return computeStats(visible);
  }, [renderCandles, computeStats, statsVersion]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;

    // When timeframe changes, discard stale fallback candles from a different timeframe
    if (lastGoodTimeframeRef.current !== timeframe) {
      lastGoodCandlesRef.current = [];
      lastGoodTimeframeRef.current = timeframe;
    }

    const incomingOk = hasDrawableCandles(renderCandles, timeframe);
    if (incomingOk) {
      lastGoodCandlesRef.current = renderCandles;
    }
    const drawCandles = incomingOk ? renderCandles : lastGoodCandlesRef.current;
    allCandlesRef.current = drawCandles;

    const draw = () => {
      const totalPoints = drawCandles.length;
      const visibleCount = Math.max(20, Math.floor(totalPoints / zoomLevelRef.current));
      const maxOffset = Math.max(0, totalPoints - visibleCount);
      scrollOffsetRef.current = clamp(scrollOffsetRef.current, 0, maxOffset);
      const startIdx = Math.round(scrollOffsetRef.current);
      const visibleCandles = drawCandles.slice(startIdx, startIdx + visibleCount);
      metaRef.current = drawPriceChart(canvas, visibleCandles, prevClose, timeframe);
      if (metaRef.current) {
        metaRef.current.startIdx = startIdx;
        metaRef.current.visibleCount = visibleCount;
        metaRef.current.totalPoints = totalPoints;
      }
    };
    redrawRef.current = draw;

    let rafId = 0;
    const scheduleDraw = () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(draw);
    };
    scheduleDraw();

    let observer = null;
    if (typeof window.ResizeObserver !== 'undefined') {
      observer = new window.ResizeObserver(() => scheduleDraw());
      observer.observe(canvas.parentElement || canvas);
    } else {
      window.addEventListener('resize', scheduleDraw);
    }
    const timeoutId = window.setTimeout(scheduleDraw, 60);

    return () => {
      window.clearTimeout(timeoutId);
      if (rafId) window.cancelAnimationFrame(rafId);
      if (observer) {
        observer.disconnect();
      } else {
        window.removeEventListener('resize', scheduleDraw);
      }
    };
  }, [renderCandles, prevClose, timeframe]);

  const handleMouseMove = useCallback((e) => {
    const overlay = overlayRef.current;
    const meta = metaRef.current;
    if (!overlay || !meta) return;
    const rect = overlay.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (isDraggingRef.current) {
      const dx = e.clientX - dragStartXRef.current;
      const { area, visibleCount } = meta;
      const pixelsPerPoint = area.w / Math.max(visibleCount - 1, 1);
      const indexDelta = -dx / pixelsPerPoint;
      const totalPoints = allCandlesRef.current.length;
      const maxOffset = Math.max(0, totalPoints - visibleCount);
      scrollOffsetRef.current = clamp(dragStartOffsetRef.current + indexDelta, 0, maxOffset);
      if (redrawRef.current) redrawRef.current();
      // Update stats
      statsVersionRef.current += 1;
      setStatsVersion(statsVersionRef.current);
    }

    // Redraw crosshair with latest meta (may have been updated by drag redraw)
    const currentMeta = metaRef.current;
    if (currentMeta) {
      drawCrosshair(overlay, currentMeta, mouseX, mouseY);
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    isDraggingRef.current = false;
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, overlay.width, overlay.height);
  }, []);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const meta = metaRef.current;
    if (!meta) return;
    const totalPoints = allCandlesRef.current.length;
    if (totalPoints < 2) return;

    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const { area, visibleCount } = meta;

    // Anchor: which data index is under the mouse
    const ratio = clamp((mouseX - area.x) / area.w, 0, 1);
    const anchorVisibleIdx = ratio * (visibleCount - 1);
    const anchorDataIdx = scrollOffsetRef.current + anchorVisibleIdx;

    // Zoom: deltaY > 0 = scroll down = zoom out, deltaY < 0 = scroll up = zoom in
    const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const oldZoom = zoomLevelRef.current;
    const newZoom = clamp(oldZoom * zoomFactor, 1, 8);
    zoomLevelRef.current = newZoom;

    // Recalculate visible count and adjust offset to keep anchor stable
    const newVisibleCount = Math.max(20, Math.floor(totalPoints / newZoom));
    const newOffset = anchorDataIdx - ratio * (newVisibleCount - 1);
    const maxOffset = Math.max(0, totalPoints - newVisibleCount);
    scrollOffsetRef.current = clamp(newOffset, 0, maxOffset);

    if (redrawRef.current) redrawRef.current();
    statsVersionRef.current += 1;
    setStatsVersion(statsVersionRef.current);

    // Redraw crosshair
    const overlay = overlayRef.current;
    const updatedMeta = metaRef.current;
    if (overlay && updatedMeta) {
      const mouseY = e.clientY - rect.top;
      drawCrosshair(overlay, updatedMeta, mouseX, mouseY);
    }
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    if (zoomLevelRef.current <= 1) return;
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartOffsetRef.current = scrollOffsetRef.current;
  }, []);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const handleDblClick = useCallback(() => {
    zoomLevelRef.current = 1;
    scrollOffsetRef.current = 0;
    if (redrawRef.current) redrawRef.current();
    statsVersionRef.current += 1;
    setStatsVersion(statsVersionRef.current);
  }, []);

  // Attach wheel event with passive:false to allow preventDefault
  useEffect(() => {
    const container = ref.current?.parentElement;
    if (!container) return undefined;
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Reset zoom when data changes
  useEffect(() => {
    zoomLevelRef.current = 1;
    scrollOffsetRef.current = 0;
  }, [renderCandles]);

  const fmtPct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

  return (
    <div>
      {stats && (
        <div className="mb-0.5 flex items-center justify-between px-1 text-[11px] leading-tight font-medium tabular-nums">
          <span className="text-[#5e74a6]">
            <span>MAX {safeNum(stats.max)}</span>
            <span className="mx-3 text-[#c0c8d8]">|</span>
            <span>MIN {safeNum(stats.min)}</span>
          </span>
          {stats.maxPct != null && (
            <span className="text-[#5e74a6]">{Math.abs(stats.maxPct).toFixed(2)}%</span>
          )}
        </div>
      )}
      <div
        className="relative"
        style={{ height: `${height}px`, cursor: zoomLevelRef.current > 1 ? 'grab' : 'default' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onDoubleClick={handleDblClick}
      >
        <canvas
          ref={ref}
          data-logical-height={height}
          style={{ height: `${height}px` }}
          className="absolute inset-0 block w-full rounded-lg bg-white"
        />
        <canvas
          ref={overlayRef}
          data-logical-height={height}
          style={{ height: `${height}px`, pointerEvents: 'none' }}
          className="absolute inset-0 block w-full rounded-lg"
        />
      </div>
    </div>
  );
}

export function FuturesVolumeCanvas({ candles = [], timeframe = '30s', height = 120 }) {
  const ref = useRef(null);
  const lastGoodCandlesRef = useRef([]);
  const lastGoodTimeframeRef = useRef(timeframe);
  const renderCandles = useMemo(
    () => compactCandlesForRender(candles, timeframe, VOLUME_RENDER_POINT_LIMIT),
    [candles, timeframe],
  );

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;

    if (lastGoodTimeframeRef.current !== timeframe) {
      lastGoodCandlesRef.current = [];
      lastGoodTimeframeRef.current = timeframe;
    }

    const incomingOk = hasDrawableCandles(renderCandles, timeframe);
    if (incomingOk) {
      lastGoodCandlesRef.current = renderCandles;
    }
    const drawCandles = incomingOk ? renderCandles : lastGoodCandlesRef.current;
    const draw = () => drawVolumeChart(canvas, drawCandles, timeframe);
    let rafId = 0;
    const scheduleDraw = () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(draw);
    };
    scheduleDraw();

    let observer = null;
    if (typeof window.ResizeObserver !== 'undefined') {
      observer = new window.ResizeObserver(() => scheduleDraw());
      observer.observe(canvas.parentElement || canvas);
    } else {
      window.addEventListener('resize', scheduleDraw);
    }
    const timeoutId = window.setTimeout(scheduleDraw, 60);

    return () => {
      window.clearTimeout(timeoutId);
      if (rafId) window.cancelAnimationFrame(rafId);
      if (observer) {
        observer.disconnect();
      } else {
        window.removeEventListener('resize', scheduleDraw);
      }
    };
  }, [renderCandles, timeframe]);

  return (
    <canvas ref={ref} data-logical-height={height} style={{ height: `${height}px` }} className="block w-full rounded-lg bg-white" />
  );
}

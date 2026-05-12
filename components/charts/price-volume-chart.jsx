'use client';

import { useEffect, useRef } from 'react';
import { CandlestickSeries, HistogramSeries, createChart, createSeriesMarkers } from 'lightweight-charts';

function toDateStringFromTime(time) {
  if (!time) return '';
  if (typeof time === 'string') return time;
  if (typeof time === 'number') {
    const d = new Date(time * 1000);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }
  if (typeof time === 'object' && Number.isFinite(time.year) && Number.isFinite(time.month) && Number.isFinite(time.day)) {
    return `${String(time.year).padStart(4, '0')}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
  }
  return '';
}

function toDateFromChartTime(time) {
  if (!time) return null;
  if (typeof time === 'number') {
    const d = new Date(time * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof time === 'string') {
    const d = new Date(`${time}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof time === 'object' && Number.isFinite(time.year) && Number.isFinite(time.month) && Number.isFinite(time.day)) {
    const d = new Date(time.year, time.month - 1, time.day);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function PriceVolumeChart({
  data = [],
  markers = [],
  height = 420,
  className = '',
  onHoverCandle = null,
  onSelectCandle = null,
  lockedCandle = null,
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const candleMapRef = useRef(new Map());
  const lockedCandleRef = useRef(null);
  const fitHashRef = useRef('');

  useEffect(() => {
    lockedCandleRef.current = lockedCandle || null;
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries) return;

    const key = String(lockedCandle?.time || lockedCandle?.date || '').trim();
    if (!key) {
      chart.clearCrosshairPosition();
      return;
    }
    const row = candleMapRef.current.get(key);
    if (!row || !Number.isFinite(Number(row.close))) return;
    chart.setCrosshairPosition(Number(row.close), row.time || row.date, candleSeries);
  }, [lockedCandle]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    container.innerHTML = '';

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { color: 'transparent' },
        textColor: 'hsl(220 14% 35%)',
      },
      localization: {
        locale: 'zh-CN',
        dateFormat: 'yyyy-MM-dd',
        priceFormatter: (price) => Number(price).toFixed(2),
      },
      grid: {
        vertLines: { color: 'hsl(220 20% 92%)' },
        horzLines: { color: 'hsl(220 20% 92%)' },
      },
      rightPriceScale: {
        borderVisible: false,
      },
      timeScale: {
        borderVisible: false,
        rightOffset: 6,
        tickMarkFormatter: (time) => {
          const d = toDateFromChartTime(time);
          if (!d) return '';
          const month = d.getMonth() + 1;
          const day = d.getDate();
          return `${month}月${day}日`;
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      crosshair: {
        vertLine: { labelVisible: false },
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#dc2626',
      downColor: '#16a34a',
      borderVisible: false,
      wickUpColor: '#dc2626',
      wickDownColor: '#16a34a',
      priceLineVisible: true,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: '',
      priceFormat: {
        type: 'volume',
      },
    });

    chart.priceScale('').applyOptions({
      scaleMargins: {
        top: 0.72,
        bottom: 0,
      },
    });
    chart.priceScale('right').applyOptions({
      scaleMargins: {
        top: 0.12,
        bottom: 0.32,
      },
    });

    const candles = Array.isArray(data) ? data : [];
    const enrichedCandles = candles.map((item, idx) => {
      const prevClose = idx > 0 ? Number(candles[idx - 1]?.close) : null;
      const close = Number(item?.close);
      const open = Number(item?.open);
      const high = Number(item?.high);
      const low = Number(item?.low);
      const changePct = Number.isFinite(prevClose) && prevClose !== 0
        ? ((close - prevClose) / prevClose) * 100
        : null;
      return {
        ...item,
        prevClose,
        changePct,
        bodyPct: Number.isFinite(prevClose) && prevClose !== 0 ? ((close - open) / prevClose) * 100 : null,
        bodyMidPrice: Number.isFinite(open) && Number.isFinite(close) ? (open + close) / 2 : null,
        amplitudePct: Number.isFinite(prevClose) && prevClose !== 0
          ? ((high - low) / prevClose) * 100
          : null,
      };
    });
    const candleMap = new Map(
      enrichedCandles.map((item) => [String(item?.time || item?.date || ''), item]),
    );
    candleMapRef.current = candleMap;

    candleSeries.setData(
      candles.map((item) => ({
        time: item.time,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
      })),
    );

    createSeriesMarkers(
      candleSeries,
      (Array.isArray(markers) ? markers : [])
        .filter((item) => item?.time)
        .map((item) => ({
          time: item.time,
          position: item.position || 'aboveBar',
          color: item.color || '#0ea5e9',
          shape: item.shape || 'circle',
          text: item.text || '',
        })),
    );

    volumeSeries.setData(
      candles.map((item) => ({
        time: item.time,
        value: item.value || 0,
        color: item.close >= item.open ? 'rgba(220,38,38,0.45)' : 'rgba(22,163,74,0.45)',
      })),
    );

    const nextFitHash = JSON.stringify({
      len: candles.length,
      first: candles[0]?.time || candles[0]?.date || '',
      last: candles[candles.length - 1]?.time || candles[candles.length - 1]?.date || '',
      markersLen: Array.isArray(markers) ? markers.length : 0,
      height,
    });
    if (fitHashRef.current !== nextFitHash) {
      chart.timeScale().fitContent();
      fitHashRef.current = nextFitHash;
    }
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    if (lockedCandleRef.current) {
      const key = String(lockedCandleRef.current?.time || lockedCandleRef.current?.date || '').trim();
      const row = candleMap.get(key);
      if (row && Number.isFinite(Number(row.close))) {
        chart.setCrosshairPosition(Number(row.close), row.time || row.date, candleSeries);
      }
    }

    const handleCrosshairMove = (param) => {
      if (lockedCandleRef.current) {
        const key = String(lockedCandleRef.current?.time || lockedCandleRef.current?.date || '').trim();
        const row = candleMap.get(key);
        if (row && Number.isFinite(Number(row.close))) {
          chart.setCrosshairPosition(Number(row.close), row.time || row.date, candleSeries);
        }
        return;
      }

      const point = param?.point;
      const key = toDateStringFromTime(param?.time);
      if (
        !key
        || !point
        || !Number.isFinite(point.x)
        || !Number.isFinite(point.y)
        || point.x < 0
        || point.y < 0
        || point.x > container.clientWidth
        || point.y > container.clientHeight
      ) {
        if (typeof onHoverCandle === 'function') onHoverCandle(null);
        return;
      }

      const item = candleMap.get(key) || null;
      if (!item) {
        if (typeof onHoverCandle === 'function') onHoverCandle(null);
        return;
      }
      if (typeof onHoverCandle === 'function') onHoverCandle(item);
    };
    chart.subscribeCrosshairMove(handleCrosshairMove);

    const handleChartClick = (param) => {
      const point = param?.point;
      const key = toDateStringFromTime(param?.time);
      if (
        !key
        || !point
        || !Number.isFinite(point.x)
        || !Number.isFinite(point.y)
        || point.x < 0
        || point.y < 0
        || point.x > container.clientWidth
        || point.y > container.clientHeight
      ) {
        return;
      }
      const item = candleMap.get(key) || null;
      if (!item) return;
      if (typeof onSelectCandle === 'function') onSelectCandle(item);
    };
    chart.subscribeClick(handleChartClick);

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth, height });
    });
    resizeObserver.observe(container);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.unsubscribeClick(handleChartClick);
      chartRef.current = null;
      candleSeriesRef.current = null;
      candleMapRef.current = new Map();
      fitHashRef.current = '';
      if (typeof onHoverCandle === 'function') onHoverCandle(null);
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [data, markers, height, onHoverCandle, onSelectCandle]);

  return <div ref={containerRef} className={className} />;
}

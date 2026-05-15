'use client';

import { useEffect, useRef } from 'react';
import {
  BaselineSeries,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
} from 'lightweight-charts';

function toDateStringFromTime(time) {
  if (!time) return '';
  if (typeof time === 'string') return String(time);
  if (typeof time === 'number') {
    return String(time);
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
  markers = null,
  height = 420,
  className = '',
  timeframe = '',
  mode = 'auto',
  referencePrice = null,
  enforceSymmetricReference = false,
  onHoverCandle = null,
  onSelectCandle = null,
  lockedCandle = null,
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const priceSeriesRef = useRef(null);
  const candleMapRef = useRef(new Map());
  const candleRowsRef = useRef([]);
  const lockedCandleRef = useRef(null);
  const fitHashRef = useRef('');

  useEffect(() => {
    lockedCandleRef.current = lockedCandle || null;
    const chart = chartRef.current;
    const priceSeries = priceSeriesRef.current;
    if (!chart || !priceSeries) return;

    const key = String(lockedCandle?.time || lockedCandle?.date || '').trim();
    if (!key) {
      chart.clearCrosshairPosition();
      return;
    }
    const row = candleMapRef.current.get(key);
    if (!row || !Number.isFinite(Number(row.close))) return;
    chart.setCrosshairPosition(Number(row.close), row.time || row.date, priceSeries);
  }, [lockedCandle]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    container.innerHTML = '';

    const normalizedTf = String(timeframe || '').trim();
    const hasIntradayTime = Array.isArray(data)
      && data.some((item) => typeof item?.time === 'number');
    const isIntradayTimeframe = hasIntradayTime || /^(\d+)(s|m)$/.test(normalizedTf);
    const displayMode = mode === 'auto'
      ? (isIntradayTimeframe ? 'intraday-line' : 'candlestick')
      : mode;
    const useIntradayLine = displayMode === 'intraday-line';

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
        percentageFormatter: (value) => {
          const n = Number(value);
          if (!Number.isFinite(n)) return '--';
          return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
        },
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
        timeVisible: isIntradayTimeframe,
        secondsVisible: false,
        tickMarkFormatter: (time) => {
          const d = toDateFromChartTime(time);
          if (!d) return '';
          if (isIntradayTimeframe) {
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            return `${hh}:${mm}`;
          }
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

    const normalizedReferencePrice = Number(referencePrice);
    const hasReferencePrice = Number.isFinite(normalizedReferencePrice) && normalizedReferencePrice > 0;
    const usePercentAxis = useIntradayLine && hasReferencePrice;
    const toPctValue = (price) => {
      const n = Number(price);
      if (!Number.isFinite(n) || !hasReferencePrice) return null;
      return ((n - normalizedReferencePrice) / normalizedReferencePrice) * 100;
    };

    const priceSeries = useIntradayLine
      ? chart.addSeries(BaselineSeries, {
        baseValue: {
          type: 'price',
          price: usePercentAxis ? 0 : (hasReferencePrice ? normalizedReferencePrice : Number(data?.[0]?.close || 0)),
        },
        topLineColor: '#2563eb',
        bottomLineColor: '#2563eb',
        topFillColor1: 'rgba(220, 38, 38, 0.12)',
        topFillColor2: 'rgba(220, 38, 38, 0.02)',
        bottomFillColor1: 'rgba(22, 163, 74, 0.10)',
        bottomFillColor2: 'rgba(22, 163, 74, 0.02)',
        lineWidth: 2,
        crosshairMarkerVisible: false,
        lastValueVisible: true,
        priceLineVisible: true,
        priceFormat: usePercentAxis
          ? {
            type: 'percent',
            precision: 2,
            minMove: 0.01,
          }
          : {
            type: 'price',
            precision: 2,
            minMove: 0.01,
          },
      })
      : chart.addSeries(CandlestickSeries, {
        upColor: '#dc2626',
        downColor: '#16a34a',
        borderVisible: false,
        wickUpColor: '#dc2626',
        wickDownColor: '#16a34a',
        priceLineVisible: true,
      });

    const avgPriceSeries = useIntradayLine
      ? chart.addSeries(LineSeries, {
        color: '#f59e0b',
        lineWidth: 1,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        priceFormat: usePercentAxis
          ? {
            type: 'percent',
            precision: 2,
            minMove: 0.01,
          }
          : {
            type: 'price',
            precision: 2,
            minMove: 0.01,
          },
      })
      : null;

    const referenceLineSeries = (useIntradayLine && hasReferencePrice)
      ? chart.addSeries(LineSeries, {
        color: 'rgba(148, 163, 184, 0.95)',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        priceFormat: usePercentAxis
          ? {
            type: 'percent',
            precision: 2,
            minMove: 0.01,
          }
          : {
            type: 'price',
            precision: 2,
            minMove: 0.01,
          },
      })
      : null;
    const upperBoundSeries = (useIntradayLine && hasReferencePrice && enforceSymmetricReference)
      ? chart.addSeries(LineSeries, {
        color: 'rgba(0, 0, 0, 0)',
        lineWidth: 1,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        priceFormat: usePercentAxis
          ? {
            type: 'percent',
            precision: 2,
            minMove: 0.01,
          }
          : {
            type: 'price',
            precision: 2,
            minMove: 0.01,
          },
      })
      : null;
    const lowerBoundSeries = (useIntradayLine && hasReferencePrice && enforceSymmetricReference)
      ? chart.addSeries(LineSeries, {
        color: 'rgba(0, 0, 0, 0)',
        lineWidth: 1,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        priceFormat: usePercentAxis
          ? {
            type: 'percent',
            precision: 2,
            minMove: 0.01,
          }
          : {
            type: 'price',
            precision: 2,
            minMove: 0.01,
          },
      })
      : null;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: 'right',
      priceFormat: {
        type: 'volume',
        precision: 0,
        minMove: 1,
      },
    }, 1);

    chart.priceScale('right', 0).applyOptions({
      scaleMargins: {
        top: useIntradayLine ? 0.08 : 0.12,
        bottom: 0.08,
      },
    });
    if (chart.panes().length > 1) {
      chart.panes()[0]?.setStretchFactor(3);
      chart.panes()[1]?.setStretchFactor(1);
      chart.priceScale('right', 1).applyOptions({
        scaleMargins: {
          top: 0.08,
          bottom: 0.08,
        },
      });
    }

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
      enrichedCandles.map((item) => [toDateStringFromTime(item?.time || item?.date || ''), item]),
    );
    candleMapRef.current = candleMap;
    candleRowsRef.current = enrichedCandles;

    if (useIntradayLine) {
      priceSeries.setData(
        candles.map((item) => ({
          time: item.time,
          value: usePercentAxis ? toPctValue(item.close) : item.close,
        })),
      );

      let cumulativeAmount = 0;
      let cumulativeVolume = 0;
      const avgLineData = candles.map((item, idx) => {
        const volume = Number(item.value || 0);
        const amount = Number(item.amount || 0);
        if (Number.isFinite(amount) && amount > 0 && Number.isFinite(volume) && volume > 0) {
          cumulativeAmount += amount;
          cumulativeVolume += volume;
        } else {
          const fallbackAmount = Number(item.close) * Math.max(volume, 0);
          cumulativeAmount += Number.isFinite(fallbackAmount) ? fallbackAmount : 0;
          cumulativeVolume += Math.max(volume, 0);
        }
        const avg = cumulativeVolume > 0 ? (cumulativeAmount / cumulativeVolume) : Number(item.close);
        return {
          time: item.time,
          value: usePercentAxis
            ? toPctValue(Number.isFinite(avg) ? avg : Number(item.close))
            : (Number.isFinite(avg) ? avg : Number(item.close)),
          _idx: idx,
        };
      });
      avgPriceSeries?.setData(avgLineData.map(({ time, value }) => ({ time, value })));

      if (referenceLineSeries && candles.length) {
        const firstTime = candles[0].time;
        const lastTime = candles[candles.length - 1].time;
        referenceLineSeries.setData([
          { time: firstTime, value: usePercentAxis ? 0 : normalizedReferencePrice },
          { time: lastTime, value: usePercentAxis ? 0 : normalizedReferencePrice },
        ]);

        if (upperBoundSeries && lowerBoundSeries) {
          const spread = candles.reduce((maxSpread, item) => {
            const high = usePercentAxis ? toPctValue(item?.high) : (Number(item?.high) - normalizedReferencePrice);
            const low = usePercentAxis ? toPctValue(item?.low) : (Number(item?.low) - normalizedReferencePrice);
            const close = usePercentAxis ? toPctValue(item?.close) : (Number(item?.close) - normalizedReferencePrice);
            const localMax = Math.max(
              Math.abs(Number(high)),
              Math.abs(Number(low)),
              Math.abs(Number(close)),
            );
            return Number.isFinite(localMax) ? Math.max(maxSpread, localMax) : maxSpread;
          }, 0);
          const safeSpread = Math.max(spread, usePercentAxis ? 0.1 : Math.abs(normalizedReferencePrice) * 0.001, 0.01);
          const upper = usePercentAxis ? safeSpread : (normalizedReferencePrice + safeSpread);
          const lower = usePercentAxis ? -safeSpread : (normalizedReferencePrice - safeSpread);
          upperBoundSeries.setData([
            { time: firstTime, value: upper },
            { time: lastTime, value: upper },
          ]);
          lowerBoundSeries.setData([
            { time: firstTime, value: lower },
            { time: lastTime, value: lower },
          ]);
        }
      }
    } else {
      priceSeries.setData(
        candles.map((item) => ({
          time: item.time,
          open: item.open,
          high: item.high,
          low: item.low,
          close: item.close,
        })),
      );
    }

    createSeriesMarkers(
      priceSeries,
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
      candles.map((item, idx) => {
        const prevClose = idx > 0 ? Number(candles[idx - 1]?.close) : Number(item?.open);
        const close = Number(item?.close);
        const up = Number.isFinite(close) && Number.isFinite(prevClose) ? close >= prevClose : close >= Number(item?.open);
        return {
          time: item.time,
          value: item.value || 0,
          color: up ? 'rgba(220,38,38,0.45)' : 'rgba(22,163,74,0.45)',
        };
      }),
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
    priceSeriesRef.current = priceSeries;
    if (lockedCandleRef.current) {
      const key = String(lockedCandleRef.current?.time || lockedCandleRef.current?.date || '').trim();
      const row = candleMap.get(key);
      if (row && Number.isFinite(Number(row.close))) {
        const targetPrice = usePercentAxis
          ? toPctValue(row.close)
          : Number(row.close);
        if (Number.isFinite(Number(targetPrice))) {
          chart.setCrosshairPosition(Number(targetPrice), row.time || row.date, priceSeries);
        }
      }
    }

    const handleCrosshairMove = (param) => {
      if (lockedCandleRef.current) {
        const key = String(lockedCandleRef.current?.time || lockedCandleRef.current?.date || '').trim();
        const row = candleMap.get(key);
        if (row && Number.isFinite(Number(row.close))) {
          const targetPrice = usePercentAxis
            ? toPctValue(row.close)
            : Number(row.close);
          if (Number.isFinite(Number(targetPrice))) {
            chart.setCrosshairPosition(Number(targetPrice), row.time || row.date, priceSeries);
          }
        }
        return;
      }

      const point = param?.point;
      const key = toDateStringFromTime(param?.time);
      if (
        !point
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
      if (item) {
        if (typeof onHoverCandle === 'function') {
          onHoverCandle(item, {
            point: point ? { x: Number(point.x), y: Number(point.y) } : null,
            width: container.clientWidth,
            height: container.clientHeight,
          });
        }
        return;
      }

      // Some lightweight-charts time payloads may not match our map key shape.
      // Fall back to logical index so intraday hover info is always available.
      const logical = Number(param?.logical);
      if (Number.isFinite(logical)) {
        const idx = Math.max(0, Math.min(candleRowsRef.current.length - 1, Math.round(logical)));
        const byIndex = candleRowsRef.current[idx] || null;
        if (byIndex) {
          if (typeof onHoverCandle === 'function') {
            onHoverCandle(byIndex, {
              point: point ? { x: Number(point.x), y: Number(point.y) } : null,
              width: container.clientWidth,
              height: container.clientHeight,
            });
          }
          return;
        }
      }

      // Ignore transient invalid events while pointer is still inside chart area.
      // Clear hover only when pointer leaves bounds (handled above).
      return;
    };
    chart.subscribeCrosshairMove(handleCrosshairMove);
    const handleMouseLeave = () => {
      if (typeof onHoverCandle === 'function') {
        onHoverCandle(null, {
          point: null,
          width: container.clientWidth,
          height: container.clientHeight,
        });
      }
    };
    container.addEventListener('mouseleave', handleMouseLeave);

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
      container.removeEventListener('mouseleave', handleMouseLeave);
      chartRef.current = null;
      priceSeriesRef.current = null;
      candleMapRef.current = new Map();
      candleRowsRef.current = [];
      fitHashRef.current = '';
      if (typeof onHoverCandle === 'function') onHoverCandle(null);
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [data, enforceSymmetricReference, markers, height, mode, onHoverCandle, onSelectCandle, referencePrice, timeframe]);

  return <div ref={containerRef} className={className} />;
}

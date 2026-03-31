'use client';

import { useEffect, useRef } from 'react';
import { CandlestickSeries, HistogramSeries, createChart } from 'lightweight-charts';

export function PriceVolumeChart({ data = [], height = 420, className = '' }) {
  const containerRef = useRef(null);

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
      upColor: '#16a34a',
      downColor: '#dc2626',
      borderVisible: false,
      wickUpColor: '#16a34a',
      wickDownColor: '#dc2626',
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

    candleSeries.setData(
      candles.map((item) => ({
        time: item.time,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
      })),
    );

    volumeSeries.setData(
      candles.map((item) => ({
        time: item.time,
        value: item.value || 0,
        color: item.close >= item.open ? 'rgba(22,163,74,0.45)' : 'rgba(220,38,38,0.45)',
      })),
    );

    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth, height });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [data, height]);

  return <div ref={containerRef} className={className} />;
}

'use client';

import { useEffect, useRef } from 'react';
import { LineSeries, createChart } from 'lightweight-charts';

export function MetricTrendChart({ data = [], height = 360, className = '' }) {
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
    });

    const avgSeries = chart.addSeries(LineSeries, {
      color: '#2563eb',
      lineWidth: 2,
      priceLineVisible: true,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
    });

    const medianSeries = chart.addSeries(LineSeries, {
      color: '#ea580c',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
    });

    const rows = (Array.isArray(data) ? data : [])
      .map((item) => ({
        time: String(item?.time || '').trim(),
        avgPrice: Number(item?.avgPrice),
        medianPrice: Number(item?.medianPrice),
      }))
      .filter((item) => item.time)
      .sort((a, b) => a.time.localeCompare(b.time));

    avgSeries.setData(
      rows
        .filter((item) => Number.isFinite(item.avgPrice))
        .map((item) => ({ time: item.time, value: item.avgPrice })),
    );
    medianSeries.setData(
      rows
        .filter((item) => Number.isFinite(item.medianPrice))
        .map((item) => ({ time: item.time, value: item.medianPrice })),
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


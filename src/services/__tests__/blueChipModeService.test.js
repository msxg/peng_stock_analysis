import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBlueChipModeAnalysis, resolveBoardProfile } from '../blueChipModeService.js';

function row(date, open, high, low, close, volume = 1000000) {
  return { date, open, high, low, close, volume };
}

test('resolveBoardProfile should classify growth board for ChiNext and STAR stocks', () => {
  assert.equal(resolveBoardProfile('SZ300750').boardType, 'growth');
  assert.equal(resolveBoardProfile('SH688981').boardType, 'growth');
  assert.equal(resolveBoardProfile('SH600519').boardType, 'main');
});

test('buildBlueChipModeAnalysis should mark index-linked start-buy and take-profit sell points', () => {
  const indexHistory = [
    row('2026-01-02', 100, 101, 99, 100),
    row('2026-01-03', 98, 99, 95, 96),
    row('2026-01-04', 93, 94, 88, 89),
    row('2026-01-05', 89, 92, 88, 91),
    row('2026-01-06', 91, 93, 90, 92),
  ];

  const stockHistory = [
    row('2026-01-02', 10.0, 10.1, 9.8, 9.9),
    row('2026-01-03', 9.8, 9.9, 9.4, 9.5),
    row('2026-01-04', 9.4, 9.5, 9.1, 9.2),
    row('2026-01-05', 9.2, 9.8, 9.1, 9.7),
    row('2026-01-06', 9.8, 10.8, 9.7, 10.7),
    row('2026-01-07', 10.7, 11.3, 10.6, 11.2),
  ];

  const analysis = buildBlueChipModeAnalysis({
    stockCode: 'SH600000',
    indexCode: 'SH000300',
    stockHistory,
    indexHistory,
    params: {
      indexDropPct: 10,
      indexStartCandlePct: 1.5,
      takeProfitPct: 10,
      stopLossPct: 5,
    },
  });

  const buySignals = analysis.signals.filter((item) => item.side === 'buy');
  const sellSignals = analysis.signals.filter((item) => item.side === 'sell');

  assert.ok(buySignals.some((item) => item.type === 'index_linked_start_buy' && item.date === '2026-01-05'));
  assert.ok(buySignals.every((item) => item.type === 'index_linked_start_buy'));
  assert.ok(sellSignals.some((item) => item.type === 'take_profit' && item.date === '2026-01-06'));
  assert.equal(analysis.summary.trades, 1);
});

test('takeProfitPct parameter should change sell trigger timing', () => {
  const indexHistory = [
    row('2026-02-01', 100, 101, 99, 100),
    row('2026-02-02', 95, 96, 94, 95),
    row('2026-02-03', 90, 91, 89, 90),
    row('2026-02-04', 90, 92, 89, 92),
    row('2026-02-05', 92, 93, 91, 92.5),
    row('2026-02-06', 92.5, 93, 91.8, 92.2),
  ];

  const stockHistory = [
    row('2026-02-01', 10.0, 10.0, 9.8, 9.9),
    row('2026-02-02', 9.8, 9.8, 9.4, 9.5),
    row('2026-02-03', 9.4, 9.4, 9.0, 9.1),
    row('2026-02-04', 9.1, 9.8, 9.0, 9.6),
    row('2026-02-05', 9.6, 10.0, 9.5, 9.9),
    row('2026-02-06', 9.9, 10.4, 9.8, 10.3),
  ];

  const strict = buildBlueChipModeAnalysis({
    stockCode: 'SH600000',
    indexCode: 'SH000300',
    stockHistory,
    indexHistory,
    params: { takeProfitPct: 7 },
  });

  const loose = buildBlueChipModeAnalysis({
    stockCode: 'SH600000',
    indexCode: 'SH000300',
    stockHistory,
    indexHistory,
    params: { takeProfitPct: 15 },
  });

  assert.ok(strict.signals.some((item) => item.type === 'take_profit'));
  assert.ok(!loose.signals.some((item) => item.type === 'take_profit'));
});

test('buildBlueChipModeAnalysis should not generate buy signals without an index start-buy trigger', () => {
  const indexHistory = [
    row('2026-03-01', 100, 101, 99, 100),
    row('2026-03-02', 100, 101, 99.5, 100.2),
    row('2026-03-03', 100.1, 101, 99.8, 100.4),
    row('2026-03-04', 100.3, 101.2, 100, 100.6),
  ];

  const stockHistory = [
    row('2026-03-01', 10.0, 10.1, 9.9, 10.0),
    row('2026-03-02', 10.0, 10.4, 9.95, 10.3),
    row('2026-03-03', 10.1, 10.25, 10.0, 10.2),
    row('2026-03-04', 10.2, 10.9, 10.15, 10.8),
  ];

  const analysis = buildBlueChipModeAnalysis({
    stockCode: 'SH600000',
    indexCode: 'SH000300',
    stockHistory,
    indexHistory,
  });

  const buySignals = analysis.signals.filter((item) => item.side === 'buy');

  assert.deepEqual(buySignals, []);
});

test('buildBlueChipModeAnalysis should mark stock-independent start-buy from stock stage drawdown and first medium bull candle', () => {
  const indexHistory = [
    row('2026-04-01', 100, 101, 99, 100),
    row('2026-04-02', 100.1, 101, 99.8, 100.2),
    row('2026-04-03', 100.2, 101, 100, 100.1),
    row('2026-04-06', 100.1, 101, 99.9, 100.3),
  ];

  const stockHistory = [
    row('2026-04-01', 10.0, 10.1, 9.9, 10.0),
    row('2026-04-02', 9.2, 9.3, 8.9, 9.0),
    row('2026-04-03', 9.0, 9.5, 8.8, 9.4),
    row('2026-04-06', 9.3, 9.35, 9.0, 9.1),
  ];

  const analysis = buildBlueChipModeAnalysis({
    stockCode: 'SH600000',
    indexCode: 'SH000300',
    stockHistory,
    indexHistory,
    params: {
      stopLossPct: 20,
      takeProfitPct: 20,
    },
  });

  const buySignals = analysis.signals.filter((item) => item.side === 'buy');

  assert.ok(buySignals.some((item) => item.type === 'stock_independent_start_buy' && item.date === '2026-04-03'));
  assert.ok((analysis.stockStartSignals?.[0]?.drawdownPct || 0) >= 10);
  assert.equal(analysis.stockStartSignals?.[0]?.startDate, '2026-04-01');
  assert.match(String(analysis.stockStartSignals?.[0]?.reason || ''), /起点:2026-04-01/);
});

test('longHalfReferenceMode should switch lose_long_half anchor between latest long bull and first long bull after start-buy', () => {
  const indexHistory = [
    row('2026-06-01', 100, 101, 99, 100),
    row('2026-06-02', 100, 101, 99, 100),
    row('2026-06-03', 100, 101, 99, 100),
    row('2026-06-04', 100, 101, 99, 100),
    row('2026-06-05', 100, 101, 99, 100),
    row('2026-06-08', 100, 101, 99, 100),
  ];

  const stockHistory = [
    row('2026-06-01', 10.00, 10.10, 9.90, 10.00),
    row('2026-06-02', 9.00, 9.10, 8.90, 9.00),   // 回撤>=10
    row('2026-06-03', 9.00, 9.40, 8.95, 9.36),   // 中阳触发买点
    row('2026-06-04', 9.36, 9.95, 9.30, 9.93),   // 起涨后首根长阳，半体=9.645
    row('2026-06-05', 9.85, 10.60, 9.80, 10.55), // 最近长阳，半体=10.20
    row('2026-06-08', 10.00, 10.05, 9.60, 9.80), // 跌破10.20但未跌破9.645
  ];

  const recentMode = buildBlueChipModeAnalysis({
    stockCode: 'SH600000',
    indexCode: 'SH000300',
    stockHistory,
    indexHistory,
    params: {
      stopLossPct: 20,
      takeProfitPct: 50,
      failPrevHighDays: 60,
      mediumBullPctMain: 4,
      longBullPctMain: 6,
      longHalfReferenceMode: 'recent_long_bull',
    },
  });

  const firstAfterMode = buildBlueChipModeAnalysis({
    stockCode: 'SH600000',
    indexCode: 'SH000300',
    stockHistory,
    indexHistory,
    params: {
      stopLossPct: 20,
      takeProfitPct: 50,
      failPrevHighDays: 60,
      mediumBullPctMain: 4,
      longBullPctMain: 6,
      longHalfReferenceMode: 'first_long_bull_after_start_buy',
    },
  });

  assert.ok(
    recentMode.signals.some((item) => item.type === 'lose_long_half' && item.date === '2026-06-08'),
    'recent_long_bull 模式应触发跌破长阳半体',
  );
  assert.ok(
    !firstAfterMode.signals.some((item) => item.type === 'lose_long_half' && item.date === '2026-06-08'),
    'first_long_bull_after_start_buy 模式不应在该日触发',
  );
});

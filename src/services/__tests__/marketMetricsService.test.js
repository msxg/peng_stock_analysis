import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeMetricRulePayload,
  isSuspendedSample,
  isStName,
  computeAveragePrice,
  computeMedianPrice,
  filterSamplesByRule,
} from '../marketMetricsService.js';

test('normalizeMetricRulePayload should apply defaults for required rule fields', () => {
  const normalized = normalizeMetricRulePayload({
    ruleKey: 'all_a_close_raw_v1',
    name: '全A默认规则',
  });

  assert.equal(normalized.ruleKey, 'ALL_A_CLOSE_RAW_V1');
  assert.equal(normalized.scopeKey, 'ALL_A');
  assert.equal(normalized.priceMode, 'close_raw');
  assert.equal(normalized.excludeSuspended, true);
  assert.equal(normalized.includeSt, true);
  assert.equal(normalized.minListingTradingDays, 0);
  assert.equal(normalized.minSampleSize, 1);
  assert.equal(normalized.isEnabled, true);
  assert.equal(normalized.isDefault, false);
});

test('isStName should identify ST variations', () => {
  assert.equal(isStName('ST海润'), true);
  assert.equal(isStName('*ST中捷'), true);
  assert.equal(isStName('S*ST银亿'), true);
  assert.equal(isStName('贵州茅台'), false);
});

test('isSuspendedSample should treat zero-vol and zero-amount rows as suspended', () => {
  assert.equal(isSuspendedSample({ close: 10, vol: 0, amount: 0 }), true);
  assert.equal(isSuspendedSample({ close: 10, vol: 1000, amount: 1000000 }), false);
});

test('filterSamplesByRule should apply ST/suspended/new-listing filters', () => {
  const samples = [
    { stockCode: 'SH600001', stockName: '正常样本', closeRaw: 10, closeQfq: null, closeHfq: null, vol: 100, amount: 2000, tradingDays: 200 },
    { stockCode: 'SZ000002', stockName: 'ST样本', closeRaw: 20, closeQfq: null, closeHfq: null, vol: 100, amount: 3000, tradingDays: 300 },
    { stockCode: 'SZ300003', stockName: '停牌样本', closeRaw: 30, closeQfq: null, closeHfq: null, vol: 0, amount: 0, tradingDays: 400 },
    { stockCode: 'BJ430004', stockName: '新股样本', closeRaw: 40, closeQfq: null, closeHfq: null, vol: 100, amount: 4000, tradingDays: 20 },
  ];

  const filtered = filterSamplesByRule(samples, {
    priceMode: 'close_raw',
    excludeSuspended: true,
    includeSt: false,
    minListingTradingDays: 60,
  });

  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0].stockCode, 'SH600001');
  assert.equal(filtered.items[0].price, 10);
  assert.equal(filtered.stats.removedSuspended, 1);
  assert.equal(filtered.stats.removedSt, 1);
  assert.equal(filtered.stats.removedNewListing, 1);
});

test('computeAveragePrice and computeMedianPrice should return numeric stats', () => {
  assert.equal(computeAveragePrice([10, 20, 30]), 20);
  assert.equal(computeMedianPrice([10, 20, 30]), 20);
  assert.equal(computeMedianPrice([10, 20, 30, 40]), 25);
});

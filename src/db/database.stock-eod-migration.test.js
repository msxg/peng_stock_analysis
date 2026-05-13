import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { normalizeStockEodBarsForTradeDayUniq } from './database.js';

function createLegacyStockEodTable(db) {
  db.exec(`
    CREATE TABLE stock_eod_bars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_code TEXT NOT NULL,
      market TEXT,
      ts_code TEXT,
      timeframe TEXT NOT NULL,
      trade_day TEXT NOT NULL,
      bucket_ts INTEGER NOT NULL,
      date TEXT NOT NULL,
      open REAL,
      high REAL,
      low REAL,
      close REAL,
      pre_close REAL,
      change REAL,
      pct_chg REAL,
      vol REAL,
      amount REAL,
      source TEXT NOT NULL DEFAULT 'tushare.daily',
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (stock_code, timeframe, bucket_ts)
    );
  `);
}

test('normalizeStockEodBarsForTradeDayUniq should deduplicate by trade_day and enforce unique trade_day key', () => {
  const db = new Database(':memory:');
  createLegacyStockEodTable(db);

  const insert = db.prepare(`
    INSERT INTO stock_eod_bars (
      stock_code, market, ts_code, timeframe, trade_day, bucket_ts, date,
      open, high, low, close, pre_close, change, pct_chg, vol, amount, source, synced_at, created_at, updated_at
    ) VALUES (
      @stock_code, @market, @ts_code, @timeframe, @trade_day, @bucket_ts, @date,
      @open, @high, @low, @close, @pre_close, @change, @pct_chg, @vol, @amount, @source, @synced_at, @created_at, @updated_at
    )
  `);

  insert.run({
    stock_code: '600519',
    market: 'A',
    ts_code: '600519.SH',
    timeframe: '1d',
    trade_day: '2025-06-13',
    bucket_ts: 1749744000,
    date: '2025-06-13',
    open: 100,
    high: 110,
    low: 99,
    close: 108,
    pre_close: 102,
    change: 6,
    pct_chg: 5.88,
    vol: 123,
    amount: 456,
    source: 'eastmoney.kline',
    synced_at: '2026-05-13 07:54:30',
    created_at: '2026-05-13 07:54:30',
    updated_at: '2026-05-13 07:54:30',
  });
  insert.run({
    stock_code: '600519',
    market: 'A',
    ts_code: '600519.SH',
    timeframe: '1d',
    trade_day: '2025-06-13',
    bucket_ts: 1749772800,
    date: '2025-06-13',
    open: 100,
    high: 111,
    low: 98,
    close: 109,
    pre_close: 102,
    change: 7,
    pct_chg: 6.86,
    vol: 321,
    amount: 654,
    source: 'tencent.fqkline',
    synced_at: '2026-05-12 12:51:23',
    created_at: '2026-05-12 12:51:23',
    updated_at: '2026-05-12 12:51:23',
  });

  normalizeStockEodBarsForTradeDayUniq(db);

  const rows = db.prepare(`
    SELECT trade_day, bucket_ts, source
    FROM stock_eod_bars
    WHERE stock_code = '600519' AND timeframe = '1d'
    ORDER BY trade_day ASC
  `).all();

  assert.equal(rows.length, 1);
  assert.equal(rows[0].trade_day, '2025-06-13');
  assert.equal(rows[0].bucket_ts, 1749744000);

  assert.throws(() => {
    db.prepare(`
      INSERT INTO stock_eod_bars (
        stock_code, market, ts_code, timeframe, trade_day, bucket_ts, date, source
      ) VALUES (
        '600519', 'A', '600519.SH', '1d', '2025-06-13', 1749800000, '2025-06-13', 'manual'
      )
    `).run();
  });
});

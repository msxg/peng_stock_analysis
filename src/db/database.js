import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { env } from '../config/env.js';
import { DEFAULT_SYSTEM_CONFIGS } from '../constants/defaultConfig.js';

let db;

function ensureDataDir() {
  const dir = path.dirname(env.DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function createSchema(connection) {
  connection.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS auth_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      auth_enabled INTEGER NOT NULL DEFAULT 0,
      password_changeable INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS system_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT,
      category TEXT NOT NULL,
      title TEXT,
      description TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS analysis_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL UNIQUE,
      query_id TEXT,
      stock_codes TEXT NOT NULL,
      status TEXT NOT NULL,
      params TEXT,
      result TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS analysis_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query_id TEXT,
      stock_code TEXT NOT NULL,
      stock_name TEXT,
      market TEXT,
      analysis_date TEXT NOT NULL,
      summary TEXT,
      recommendation TEXT,
      buy_price REAL,
      stop_loss REAL,
      target_price REAL,
      confidence REAL,
      technical_payload TEXT,
      news_payload TEXT,
      report_markdown TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_history_stock_date ON analysis_history (stock_code, analysis_date DESC);
    CREATE INDEX IF NOT EXISTS idx_history_query ON analysis_history (query_id);

    CREATE TABLE IF NOT EXISTS backtest_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER NOT NULL,
      stock_code TEXT NOT NULL,
      evaluation_days INTEGER NOT NULL,
      start_price REAL,
      end_price REAL,
      return_pct REAL,
      direction_hit INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (analysis_id) REFERENCES analysis_history(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_backtest_analysis ON backtest_results (analysis_id, evaluation_days);

    CREATE TABLE IF NOT EXISTS portfolio_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      base_currency TEXT NOT NULL DEFAULT 'CNY',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS portfolio_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      stock_code TEXT NOT NULL,
      market TEXT,
      side TEXT NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      trade_date TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES portfolio_accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS portfolio_cash_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CNY',
      occurred_at TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES portfolio_accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS portfolio_corporate_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      stock_code TEXT NOT NULL,
      action_type TEXT NOT NULL,
      ratio REAL,
      cash_amount REAL,
      effective_date TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES portfolio_accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS futures_basics (
      quote_code TEXT PRIMARY KEY,
      market INTEGER,
      code TEXT NOT NULL,
      name TEXT,
      exchange TEXT,
      trading_hours TEXT,
      source TEXT,
      synced_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_futures_basics_code ON futures_basics (code);

    CREATE TABLE IF NOT EXISTS futures_intraday_bars (
      quote_code TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      trade_day TEXT NOT NULL,
      bucket_ts INTEGER NOT NULL,
      date TEXT NOT NULL,
      open REAL,
      high REAL,
      low REAL,
      close REAL,
      volume REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (quote_code, timeframe, bucket_ts)
    );

    CREATE INDEX IF NOT EXISTS idx_futures_intraday_lookup
      ON futures_intraday_bars (quote_code, timeframe, trade_day, bucket_ts ASC);

    CREATE TABLE IF NOT EXISTS futures_eod_bars (
      quote_code TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      trade_day TEXT NOT NULL,
      bucket_ts INTEGER NOT NULL,
      date TEXT NOT NULL,
      open REAL,
      high REAL,
      low REAL,
      close REAL,
      volume REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (quote_code, timeframe, bucket_ts)
    );

    CREATE INDEX IF NOT EXISTS idx_futures_eod_lookup
      ON futures_eod_bars (quote_code, timeframe, trade_day, bucket_ts ASC);

    CREATE TABLE IF NOT EXISTS stock_basics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market TEXT NOT NULL,
      sub_market TEXT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      sector TEXT,
      industry TEXT,
      latest_price REAL,
      total_shares REAL,
      float_shares REAL,
      total_market_cap REAL,
      float_market_cap REAL,
      listing_date TEXT,
      main_business TEXT,
      business_scope TEXT,
      company_profile TEXT,
      trading_hours TEXT,
      fundamentals_source TEXT,
      fundamentals_synced_at TEXT,
      source TEXT,
      synced_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (market, code)
    );

    CREATE INDEX IF NOT EXISTS idx_stock_basics_market_code ON stock_basics (market, code);
    CREATE INDEX IF NOT EXISTS idx_stock_basics_name ON stock_basics (name);

    CREATE TABLE IF NOT EXISTS monitor_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 100,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS monitor_symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      symbol_code TEXT NOT NULL,
      quote_code TEXT,
      symbol_type TEXT NOT NULL,
      market TEXT NOT NULL,
      exchange TEXT,
      display_name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 100,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES monitor_categories(id) ON DELETE CASCADE,
      UNIQUE (category_id, symbol_type, market, symbol_code)
    );

    CREATE INDEX IF NOT EXISTS idx_monitor_symbols_category ON monitor_symbols (category_id, sort_order ASC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_monitor_symbols_active ON monitor_symbols (is_active, sort_order ASC, id ASC);

    CREATE TABLE IF NOT EXISTS stock_intraday_bars (
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
      source TEXT NOT NULL DEFAULT 'tushare.pro_bar',
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (stock_code, timeframe, bucket_ts)
    );

    CREATE INDEX IF NOT EXISTS idx_stock_intraday_bars_lookup
      ON stock_intraday_bars (stock_code, timeframe, trade_day, bucket_ts ASC);
    CREATE INDEX IF NOT EXISTS idx_stock_intraday_bars_tf_day
      ON stock_intraday_bars (timeframe, trade_day);
    CREATE INDEX IF NOT EXISTS idx_stock_intraday_bars_tf_day_bucket_code
      ON stock_intraday_bars (timeframe, trade_day, bucket_ts DESC, stock_code ASC);
    CREATE INDEX IF NOT EXISTS idx_stock_intraday_bars_tf_day_code
      ON stock_intraday_bars (timeframe, trade_day, stock_code);
    CREATE INDEX IF NOT EXISTS idx_stock_intraday_bars_tf_day_desc_bucket_code
      ON stock_intraday_bars (timeframe, trade_day DESC, bucket_ts DESC, stock_code ASC);

    CREATE TABLE IF NOT EXISTS stock_eod_bars (
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
      UNIQUE (stock_code, timeframe, trade_day)
    );

    CREATE INDEX IF NOT EXISTS idx_stock_eod_bars_lookup
      ON stock_eod_bars (stock_code, timeframe, trade_day, bucket_ts ASC);
    CREATE INDEX IF NOT EXISTS idx_stock_eod_bars_tf_day
      ON stock_eod_bars (timeframe, trade_day);
    CREATE INDEX IF NOT EXISTS idx_stock_eod_bars_tf_day_bucket_code
      ON stock_eod_bars (timeframe, trade_day, bucket_ts DESC, stock_code ASC);
    CREATE INDEX IF NOT EXISTS idx_stock_eod_bars_tf_day_code
      ON stock_eod_bars (timeframe, trade_day, stock_code);
    CREATE INDEX IF NOT EXISTS idx_stock_eod_bars_tf_day_desc_bucket_code
      ON stock_eod_bars (timeframe, trade_day DESC, bucket_ts DESC, stock_code ASC);

    CREATE TABLE IF NOT EXISTS market_sync_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      market_scope TEXT NOT NULL,
      dataset_scope TEXT,
      symbol_type TEXT,
      timeframe TEXT,
      start_date TEXT,
      end_date TEXT,
      status TEXT NOT NULL,
      requested_by TEXT,
      params_json TEXT,
      summary_json TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_market_sync_jobs_status
      ON market_sync_jobs (status, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_market_sync_jobs_type_created
      ON market_sync_jobs (job_type, created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS market_sync_job_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      symbol_code TEXT,
      quote_code TEXT,
      symbol_type TEXT,
      market TEXT,
      timeframe TEXT,
      range_start TEXT,
      range_end TEXT,
      source_provider TEXT,
      status TEXT NOT NULL,
      bars_written INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES market_sync_jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_market_sync_job_items_job
      ON market_sync_job_items (job_id, id ASC);
    CREATE INDEX IF NOT EXISTS idx_market_sync_job_items_status
      ON market_sync_job_items (status, created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS market_data_quality_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_name TEXT NOT NULL,
      symbol_type TEXT,
      market TEXT,
      timeframe TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_key TEXT,
      start_date TEXT,
      end_date TEXT,
      total_expected INTEGER NOT NULL DEFAULT 0,
      total_actual INTEGER NOT NULL DEFAULT 0,
      gap_count INTEGER NOT NULL DEFAULT 0,
      anomaly_count INTEGER NOT NULL DEFAULT 0,
      coverage_ratio REAL,
      report_json TEXT,
      generated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_market_quality_reports_dataset
      ON market_data_quality_reports (dataset_name, timeframe, generated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_market_quality_reports_scope
      ON market_data_quality_reports (scope_type, scope_key, generated_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS a_share_market_metric_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      scope_key TEXT NOT NULL DEFAULT 'ALL_A',
      price_mode TEXT NOT NULL DEFAULT 'close_raw',
      exclude_suspended INTEGER NOT NULL DEFAULT 1,
      min_listing_trading_days INTEGER NOT NULL DEFAULT 0,
      include_st INTEGER NOT NULL DEFAULT 1,
      min_sample_size INTEGER NOT NULL DEFAULT 1,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_a_share_metric_rules_enabled_updated
      ON a_share_market_metric_rules (is_enabled, updated_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS a_share_market_metrics_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_day TEXT NOT NULL,
      rule_id INTEGER NOT NULL,
      rule_key_snapshot TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      price_mode TEXT NOT NULL,
      avg_price REAL,
      median_price REAL,
      sample_size INTEGER NOT NULL DEFAULT 0,
      source_dataset TEXT NOT NULL DEFAULT 'stock_eod_bars',
      computed_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (rule_id) REFERENCES a_share_market_metric_rules(id) ON DELETE CASCADE,
      UNIQUE (trade_day, rule_id, scope_key)
    );

    CREATE INDEX IF NOT EXISTS idx_a_share_metrics_daily_scope_day
      ON a_share_market_metrics_daily (scope_key, trade_day DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_a_share_metrics_daily_rule_day
      ON a_share_market_metrics_daily (rule_id, trade_day DESC, id DESC);

    CREATE TABLE IF NOT EXISTS bluechip_pools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 100,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bluechip_pool_symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool_id INTEGER NOT NULL,
      stock_code TEXT NOT NULL,
      stock_name TEXT,
      sort_order INTEGER NOT NULL DEFAULT 100,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (pool_id) REFERENCES bluechip_pools(id) ON DELETE CASCADE,
      UNIQUE (pool_id, stock_code)
    );

    CREATE INDEX IF NOT EXISTS idx_bluechip_pool_symbols_pool ON bluechip_pool_symbols (pool_id, sort_order ASC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_bluechip_pool_symbols_active ON bluechip_pool_symbols (is_active, sort_order ASC, id ASC);

    CREATE TABLE IF NOT EXISTS bluechip_analysis_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      analysis_mode TEXT NOT NULL,
      source_mode TEXT NOT NULL,
      pool_id INTEGER,
      pool_code TEXT,
      pool_name TEXT,
      index_code TEXT,
      index_name TEXT,
      analysis_date TEXT NOT NULL,
      signal_date TEXT NOT NULL,
      stock_code TEXT NOT NULL,
      stock_name TEXT,
      signal_side TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      signal_price REAL,
      signal_reason TEXT,
      signal_pnl_pct REAL,
      params_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_bluechip_analysis_signals_batch
      ON bluechip_analysis_signals (batch_id, id ASC);
    CREATE INDEX IF NOT EXISTS idx_bluechip_analysis_signals_analysis_date
      ON bluechip_analysis_signals (analysis_date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_bluechip_analysis_signals_signal_date
      ON bluechip_analysis_signals (signal_date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_bluechip_analysis_signals_stock
      ON bluechip_analysis_signals (stock_code, signal_date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_bluechip_analysis_signals_pool
      ON bluechip_analysis_signals (pool_code, analysis_date DESC, id DESC);

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      user_id TEXT,
      title TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(session_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      model TEXT,
      token_in INTEGER DEFAULT 0,
      token_out INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS news_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 100,
      config_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS news_provider_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_key TEXT NOT NULL,
      category_key TEXT NOT NULL,
      parent_category_key TEXT,
      name TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 100,
      is_active INTEGER NOT NULL DEFAULT 1,
      scheduler_enabled INTEGER NOT NULL DEFAULT 1,
      scheduler_priority INTEGER NOT NULL DEFAULT 100,
      meta_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (provider_key, category_key)
    );

    CREATE INDEX IF NOT EXISTS idx_news_provider_categories_parent
      ON news_provider_categories (provider_key, parent_category_key, sort_order ASC, id ASC);

    CREATE TABLE IF NOT EXISTS news_taxonomies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      taxonomy_key TEXT NOT NULL UNIQUE,
      parent_taxonomy_key TEXT,
      name TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 100,
      is_active INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      meta_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_news_taxonomies_parent
      ON news_taxonomies (parent_taxonomy_key, sort_order ASC, id ASC);

    CREATE TABLE IF NOT EXISTS news_taxonomy_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_key TEXT NOT NULL,
      provider_category_key TEXT NOT NULL,
      taxonomy_key TEXT NOT NULL,
      mapping_type TEXT NOT NULL DEFAULT 'auto',
      confidence REAL NOT NULL DEFAULT 0.8,
      is_manual INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (provider_key, provider_category_key, taxonomy_key)
    );

    CREATE INDEX IF NOT EXISTS idx_news_taxonomy_mappings_taxonomy
      ON news_taxonomy_mappings (taxonomy_key, provider_key, provider_category_key);

    CREATE TABLE IF NOT EXISTS news_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL UNIQUE,
      provider_key TEXT NOT NULL,
      category_key TEXT,
      trigger_type TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'queued',
      sync_mode TEXT NOT NULL DEFAULT 'catalog',
      window_start TEXT,
      window_end TEXT,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT,
      raw_count INTEGER NOT NULL DEFAULT 0,
      normalized_count INTEGER NOT NULL DEFAULT 0,
      inserted_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      deduped_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      stats_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_news_sync_runs_provider
      ON news_sync_runs (provider_key, category_key, requested_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_news_sync_runs_status
      ON news_sync_runs (status, requested_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS news_scheduler_states (
      provider_key TEXT NOT NULL PRIMARY KEY,
      round_robin_cursor INTEGER NOT NULL DEFAULT 0,
      last_catalog_sync_at INTEGER NOT NULL DEFAULT 0,
      retry_state_json TEXT,
      last_tick_at TEXT,
      last_result_json TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS news_raw_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      provider_key TEXT NOT NULL,
      provider_item_id TEXT,
      category_key TEXT,
      payload_json TEXT NOT NULL,
      payload_hash TEXT,
      published_at TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_news_raw_items_provider_item
      ON news_raw_items (provider_key, provider_item_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_news_raw_items_category_time
      ON news_raw_items (category_key, published_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_news_raw_items_hash
      ON news_raw_items (payload_hash);

    CREATE TABLE IF NOT EXISTS news_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      news_uid TEXT NOT NULL UNIQUE,
      provider_key TEXT NOT NULL,
      provider_item_id TEXT,
      provider_category_key TEXT,
      canonical_title TEXT,
      title TEXT NOT NULL,
      summary TEXT,
      content TEXT,
      url TEXT,
      source_name TEXT,
      author TEXT,
      lang TEXT,
      region TEXT,
      importance_score REAL NOT NULL DEFAULT 0,
      hot_score REAL NOT NULL DEFAULT 0,
      dedupe_fingerprint TEXT,
      event_fingerprint TEXT,
      published_at TEXT,
      ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_deleted INTEGER NOT NULL DEFAULT 0,
      meta_json TEXT,
      UNIQUE (provider_key, provider_item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_news_items_published
      ON news_items (published_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_news_items_category_published
      ON news_items (provider_category_key, published_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_news_items_importance
      ON news_items (importance_score DESC, published_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_news_items_dedupe
      ON news_items (dedupe_fingerprint);
    CREATE INDEX IF NOT EXISTS idx_news_items_event
      ON news_items (event_fingerprint);

    CREATE TABLE IF NOT EXISTS news_item_taxonomies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      news_uid TEXT NOT NULL,
      taxonomy_key TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'mapping',
      confidence REAL NOT NULL DEFAULT 0.8,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (news_uid, taxonomy_key, source)
    );

    CREATE INDEX IF NOT EXISTS idx_news_item_taxonomies_taxonomy
      ON news_item_taxonomies (taxonomy_key, created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS news_item_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      news_uid TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      entity_name TEXT,
      relation_type TEXT,
      confidence REAL NOT NULL DEFAULT 0.8,
      source TEXT NOT NULL DEFAULT 'rule',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_news_item_entities_entity
      ON news_item_entities (entity_type, entity_key, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_news_item_entities_news
      ON news_item_entities (news_uid, id DESC);

    CREATE TABLE IF NOT EXISTS news_clusters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cluster_id TEXT NOT NULL UNIQUE,
      cluster_key TEXT,
      headline TEXT,
      summary TEXT,
      taxonomy_key TEXT,
      importance_score REAL NOT NULL DEFAULT 0,
      published_at TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      item_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      meta_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_news_clusters_taxonomy
      ON news_clusters (taxonomy_key, last_seen_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_news_clusters_importance
      ON news_clusters (importance_score DESC, last_seen_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS news_cluster_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cluster_id TEXT NOT NULL,
      news_uid TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (cluster_id, news_uid)
    );

    CREATE INDEX IF NOT EXISTS idx_news_cluster_items_news
      ON news_cluster_items (news_uid, id DESC);

    CREATE TABLE IF NOT EXISTS news_ai_digests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      digest_id TEXT NOT NULL UNIQUE,
      digest_type TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_key TEXT,
      title TEXT NOT NULL,
      summary TEXT,
      highlights_json TEXT,
      risks_json TEXT,
      related_entities_json TEXT,
      model TEXT,
      prompt_version TEXT,
      source_cluster_ids_json TEXT,
      source_news_uids_json TEXT,
      generated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_news_ai_digests_lookup
      ON news_ai_digests (digest_type, scope_type, scope_key, generated_at DESC, id DESC);
  `);
}

function hasColumn(connection, tableName, columnName) {
  const rows = connection.prepare(`PRAGMA table_info(${tableName})`).all();
  return rows.some((row) => row.name === columnName);
}

function hasTable(connection, tableName) {
  const row = connection.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
    LIMIT 1
  `).get(tableName);
  return Boolean(row?.name);
}

function hasUniqueIndex(connection, tableName, columns = []) {
  const expected = columns.map((item) => String(item || '').trim()).filter(Boolean);
  if (!expected.length) return false;
  const indexes = connection.prepare(`PRAGMA index_list(${tableName})`).all();
  return indexes.some((indexRow) => {
    if (Number(indexRow?.unique) !== 1) return false;
    const cols = connection.prepare(`PRAGMA index_info(${indexRow.name})`).all()
      .sort((a, b) => Number(a.seqno || 0) - Number(b.seqno || 0))
      .map((item) => String(item?.name || '').trim());
    return cols.length === expected.length && cols.every((name, idx) => name === expected[idx]);
  });
}

function countStockEodTradeDayDuplicates(connection) {
  if (!hasTable(connection, 'stock_eod_bars')) return 0;
  const row = connection.prepare(`
    SELECT COUNT(*) AS total
    FROM (
      SELECT stock_code, timeframe, trade_day, COUNT(*) AS cnt
      FROM stock_eod_bars
      GROUP BY stock_code, timeframe, trade_day
      HAVING cnt > 1
    ) t
  `).get();
  return Number(row?.total || 0);
}

export function normalizeStockEodBarsForTradeDayUniq(connection) {
  if (!hasTable(connection, 'stock_eod_bars')) return;

  const hasTargetUnique = hasUniqueIndex(connection, 'stock_eod_bars', ['stock_code', 'timeframe', 'trade_day']);
  const duplicateDays = countStockEodTradeDayDuplicates(connection);
  if (hasTargetUnique && duplicateDays === 0) return;

  const tx = connection.transaction(() => {
    connection.exec('DROP TABLE IF EXISTS stock_eod_bars__new;');

    connection.exec(`
      CREATE TABLE stock_eod_bars__new (
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
        UNIQUE (stock_code, timeframe, trade_day)
      );
    `);

    connection.exec(`
      INSERT INTO stock_eod_bars__new (
        stock_code, market, ts_code, timeframe, trade_day, bucket_ts, date,
        open, high, low, close, pre_close, change, pct_chg, vol, amount, source, synced_at, created_at, updated_at
      )
      SELECT
        stock_code,
        market,
        ts_code,
        timeframe,
        trade_day,
        CAST(strftime('%s', trade_day || ' 00:00:00', '-8 hours') AS INTEGER) AS bucket_ts,
        trade_day AS date,
        open, high, low, close, pre_close, change, pct_chg, vol, amount, source,
        COALESCE(synced_at, datetime('now')) AS synced_at,
        COALESCE(created_at, datetime('now')) AS created_at,
        COALESCE(updated_at, datetime('now')) AS updated_at
      FROM (
        SELECT
          *,
          ROW_NUMBER() OVER (
            PARTITION BY stock_code, timeframe, trade_day
            ORDER BY datetime(COALESCE(updated_at, created_at, synced_at)) DESC, id DESC
          ) AS rn
        FROM stock_eod_bars
        WHERE stock_code IS NOT NULL
          AND timeframe IS NOT NULL
          AND trade_day IS NOT NULL
      ) ranked
      WHERE rn = 1;
    `);

    connection.exec('DROP TABLE stock_eod_bars;');
    connection.exec('ALTER TABLE stock_eod_bars__new RENAME TO stock_eod_bars;');
    connection.exec(`
      CREATE INDEX IF NOT EXISTS idx_stock_eod_bars_lookup
      ON stock_eod_bars (stock_code, timeframe, trade_day, bucket_ts ASC);
      CREATE INDEX IF NOT EXISTS idx_stock_eod_bars_tf_day
      ON stock_eod_bars (timeframe, trade_day);
      CREATE INDEX IF NOT EXISTS idx_stock_eod_bars_tf_day_bucket_code
      ON stock_eod_bars (timeframe, trade_day, bucket_ts DESC, stock_code ASC);
      CREATE INDEX IF NOT EXISTS idx_stock_eod_bars_tf_day_code
      ON stock_eod_bars (timeframe, trade_day, stock_code);
      CREATE INDEX IF NOT EXISTS idx_stock_eod_bars_tf_day_desc_bucket_code
      ON stock_eod_bars (timeframe, trade_day DESC, bucket_ts DESC, stock_code ASC);
    `);
  });

  tx();
}

function toFuturesMarketTag(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 'FUTURES_UNKNOWN';
  const match = raw.match(/(\d{2,3})/);
  return match ? `FUTURES_${match[1]}` : `FUTURES_${raw.toUpperCase()}`;
}

function migrateLegacyMonitorConfig(connection) {
  if (!hasTable(connection, 'monitor_categories') || !hasTable(connection, 'monitor_symbols')) return;

  const legacyStockCount = hasTable(connection, 'stock_monitor_symbols')
    ? Number(connection.prepare('SELECT COUNT(*) AS total FROM stock_monitor_symbols').get()?.total || 0)
    : 0;
  const legacyFuturesCount = hasTable(connection, 'futures_symbols')
    ? Number(connection.prepare('SELECT COUNT(*) AS total FROM futures_symbols').get()?.total || 0)
    : 0;
  const targetStockCount = Number(connection.prepare(`
    SELECT COUNT(*) AS total
    FROM monitor_symbols
    WHERE LOWER(symbol_type) = 'stock'
  `).get()?.total || 0);
  const targetFuturesCount = Number(connection.prepare(`
    SELECT COUNT(*) AS total
    FROM monitor_symbols
    WHERE LOWER(symbol_type) = 'futures'
  `).get()?.total || 0);
  if (
    legacyStockCount <= targetStockCount
    && legacyFuturesCount <= targetFuturesCount
    && (legacyStockCount + legacyFuturesCount) > 0
  ) {
    return;
  }

  const insertCategory = connection.prepare(`
    INSERT INTO monitor_categories (name, description, sort_order, is_enabled, created_at, updated_at)
    VALUES (
      @name,
      @description,
      @sortOrder,
      @isEnabled,
      COALESCE(@createdAt, datetime('now')),
      COALESCE(@updatedAt, datetime('now'))
    )
    ON CONFLICT(name) DO UPDATE SET
      description = COALESCE(excluded.description, monitor_categories.description),
      sort_order = excluded.sort_order,
      is_enabled = excluded.is_enabled,
      updated_at = excluded.updated_at
  `);
  const getCategoryId = connection.prepare('SELECT id FROM monitor_categories WHERE name = ? LIMIT 1');
  const insertSymbol = connection.prepare(`
    INSERT INTO monitor_symbols (
      category_id, symbol_code, quote_code, symbol_type, market, exchange, display_name, sort_order, is_active, created_at, updated_at
    )
    VALUES (
      @categoryId, @symbolCode, @quoteCode, @symbolType, @market, @exchange, @displayName, @sortOrder, @isActive,
      COALESCE(@createdAt, datetime('now')), COALESCE(@updatedAt, datetime('now'))
    )
    ON CONFLICT(category_id, symbol_type, market, symbol_code) DO UPDATE SET
      quote_code = excluded.quote_code,
      display_name = excluded.display_name,
      sort_order = excluded.sort_order,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at
  `);

  const tx = connection.transaction(() => {
    if (hasTable(connection, 'stock_monitor_categories')) {
      const categories = connection.prepare(`
        SELECT id, name, description, sort_order, is_enabled, created_at, updated_at
        FROM stock_monitor_categories
      `).all();
      const symbols = hasTable(connection, 'stock_monitor_symbols')
        ? connection.prepare(`
          SELECT category_id, stock_code, market, name, sort_order, is_active, created_at, updated_at
          FROM stock_monitor_symbols
        `).all()
        : [];

      const categoryIdMap = new Map();
      categories.forEach((item) => {
        insertCategory.run({
          name: item.name,
          description: item.description || null,
          sortOrder: item.sort_order ?? 100,
          isEnabled: item.is_enabled ?? 1,
          createdAt: item.created_at || null,
          updatedAt: item.updated_at || null,
        });
        const mapped = getCategoryId.get(item.name);
        if (mapped?.id) categoryIdMap.set(item.id, mapped.id);
      });

      symbols.forEach((item) => {
        const targetCategoryId = categoryIdMap.get(item.category_id);
        if (!targetCategoryId) return;
        insertSymbol.run({
          categoryId: targetCategoryId,
          symbolCode: String(item.stock_code || '').trim(),
          quoteCode: String(item.stock_code || '').trim() || null,
          symbolType: 'stock',
          market: String(item.market || 'A').trim().toUpperCase() || 'A',
          exchange: null,
          displayName: String(item.name || item.stock_code || '').trim() || String(item.stock_code || '').trim(),
          sortOrder: item.sort_order ?? 100,
          isActive: item.is_active ?? 1,
          createdAt: item.created_at || null,
          updatedAt: item.updated_at || null,
        });
      });
    }

    if (hasTable(connection, 'futures_categories')) {
      const categories = connection.prepare(`
        SELECT id, name, description, sort_order, is_enabled, created_at, updated_at
        FROM futures_categories
      `).all();
      const symbols = hasTable(connection, 'futures_symbols')
        ? connection.prepare(`
          SELECT category_id, quote_code, market, code, name, sort_order, is_active, created_at, updated_at
          FROM futures_symbols
        `).all()
        : [];

      const categoryIdMap = new Map();
      categories.forEach((item) => {
        const categoryName = `期货-${item.name}`;
        insertCategory.run({
          name: categoryName,
          description: item.description || null,
          sortOrder: item.sort_order ?? 100,
          isEnabled: item.is_enabled ?? 1,
          createdAt: item.created_at || null,
          updatedAt: item.updated_at || null,
        });
        const mapped = getCategoryId.get(categoryName);
        if (mapped?.id) categoryIdMap.set(item.id, mapped.id);
      });

      symbols.forEach((item) => {
        const targetCategoryId = categoryIdMap.get(item.category_id);
        if (!targetCategoryId) return;
        const quoteCode = String(item.quote_code || '').trim().toUpperCase();
        const symbolCode = String(item.code || quoteCode).trim().toUpperCase();
        insertSymbol.run({
          categoryId: targetCategoryId,
          symbolCode,
          quoteCode: quoteCode || null,
          symbolType: 'futures',
          market: toFuturesMarketTag(item.market),
          exchange: null,
          displayName: String(item.name || symbolCode || quoteCode).trim() || symbolCode || quoteCode,
          sortOrder: item.sort_order ?? 100,
          isActive: item.is_active ?? 1,
          createdAt: item.created_at || null,
          updatedAt: item.updated_at || null,
        });
      });
    }
  });

  tx();
}

function migrateLegacyStockDailyBars(connection) {
  if (!hasTable(connection, 'stock_daily_bars') || !hasTable(connection, 'stock_eod_bars')) return;
  const legacyCount = Number(connection.prepare('SELECT COUNT(*) AS total FROM stock_daily_bars').get()?.total || 0);
  if (legacyCount <= 0) return;
  const migratedCount = Number(connection.prepare(`
    SELECT COUNT(*) AS total
    FROM stock_eod_bars
    WHERE timeframe = '1d'
  `).get()?.total || 0);
  if (migratedCount >= legacyCount) return;

  connection.exec(`
    INSERT INTO stock_eod_bars (
      stock_code, market, ts_code, timeframe, trade_day, bucket_ts, date, open, high, low, close, pre_close, change, pct_chg, vol, amount, source, synced_at, created_at, updated_at
    )
    SELECT
      stock_code,
      NULL AS market,
      ts_code,
      '1d' AS timeframe,
      substr(trade_date, 1, 4) || '-' || substr(trade_date, 5, 2) || '-' || substr(trade_date, 7, 2) AS trade_day,
      CAST(strftime('%s', substr(trade_date, 1, 4) || '-' || substr(trade_date, 5, 2) || '-' || substr(trade_date, 7, 2) || ' 00:00:00') AS INTEGER) AS bucket_ts,
      substr(trade_date, 1, 4) || '-' || substr(trade_date, 5, 2) || '-' || substr(trade_date, 7, 2) AS date,
      open, high, low, close, pre_close, change, pct_chg, vol, amount, source,
      COALESCE(synced_at, datetime('now')) AS synced_at,
      COALESCE(created_at, datetime('now')) AS created_at,
      COALESCE(updated_at, datetime('now')) AS updated_at
    FROM stock_daily_bars
    WHERE stock_code IS NOT NULL
      AND trade_date IS NOT NULL
      AND LENGTH(trade_date) = 8
    ON CONFLICT(stock_code, timeframe, trade_day) DO UPDATE SET
      ts_code = excluded.ts_code,
      bucket_ts = excluded.bucket_ts,
      date = excluded.date,
      open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      pre_close = excluded.pre_close,
      change = excluded.change,
      pct_chg = excluded.pct_chg,
      vol = excluded.vol,
      amount = excluded.amount,
      source = excluded.source,
      synced_at = excluded.synced_at,
      updated_at = datetime('now')
  `);
}

function ensureMarketDataPerformanceIndexes(connection) {
  connection.exec(`
    CREATE INDEX IF NOT EXISTS idx_stock_intraday_bars_tf_day
      ON stock_intraday_bars (timeframe, trade_day);
    CREATE INDEX IF NOT EXISTS idx_stock_intraday_bars_tf_day_bucket_code
      ON stock_intraday_bars (timeframe, trade_day, bucket_ts DESC, stock_code ASC);
    CREATE INDEX IF NOT EXISTS idx_stock_intraday_bars_tf_day_code
      ON stock_intraday_bars (timeframe, trade_day, stock_code);
    CREATE INDEX IF NOT EXISTS idx_stock_intraday_bars_tf_day_desc_bucket_code
      ON stock_intraday_bars (timeframe, trade_day DESC, bucket_ts DESC, stock_code ASC);
    CREATE INDEX IF NOT EXISTS idx_stock_eod_bars_tf_day
      ON stock_eod_bars (timeframe, trade_day);
    CREATE INDEX IF NOT EXISTS idx_stock_eod_bars_tf_day_bucket_code
      ON stock_eod_bars (timeframe, trade_day, bucket_ts DESC, stock_code ASC);
    CREATE INDEX IF NOT EXISTS idx_stock_eod_bars_tf_day_code
      ON stock_eod_bars (timeframe, trade_day, stock_code);
    CREATE INDEX IF NOT EXISTS idx_stock_eod_bars_tf_day_desc_bucket_code
      ON stock_eod_bars (timeframe, trade_day DESC, bucket_ts DESC, stock_code ASC);
  `);
}

function dropLegacyMonitorTables(connection) {
  connection.exec(`
    DROP TABLE IF EXISTS futures_symbols;
    DROP TABLE IF EXISTS futures_categories;
    DROP TABLE IF EXISTS stock_monitor_symbols;
    DROP TABLE IF EXISTS stock_monitor_categories;
  `);
}

function ensureMarketMetricRuleDefaults(connection) {
  if (!hasTable(connection, 'a_share_market_metric_rules')) return;
  if (!hasColumn(connection, 'a_share_market_metric_rules', 'is_default')) {
    connection.exec('ALTER TABLE a_share_market_metric_rules ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0');
  }

  const total = Number(connection.prepare(`
    SELECT COUNT(*) AS total
    FROM a_share_market_metric_rules
  `).get()?.total || 0);
  if (total <= 0) return;

  const defaults = connection.prepare(`
    SELECT id
    FROM a_share_market_metric_rules
    WHERE scope_key = 'ALL_A' AND is_default = 1
    ORDER BY is_enabled DESC, updated_at DESC, id DESC
  `).all();

  const pickRow = defaults[0] || connection.prepare(`
    SELECT id
    FROM a_share_market_metric_rules
    WHERE scope_key = 'ALL_A'
    ORDER BY (rule_key = 'ALL_A_CLOSE_RAW_V1') DESC, is_enabled DESC, updated_at DESC, id DESC
    LIMIT 1
  `).get();

  if (pickRow?.id) {
    const tx = connection.transaction(() => {
      connection.prepare(`
        UPDATE a_share_market_metric_rules
        SET is_default = 0
        WHERE scope_key = 'ALL_A'
          AND id != @id
          AND is_default = 1
      `).run({ id: pickRow.id });
      connection.prepare(`
        UPDATE a_share_market_metric_rules
        SET is_default = 1
        WHERE id = @id
      `).run({ id: pickRow.id });
    });
    tx();
  }

  connection.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_a_share_metric_rules_scope_default
      ON a_share_market_metric_rules (scope_key)
      WHERE is_default = 1;
  `);
}

function ensureMigrations(connection) {
  if (!hasColumn(connection, 'backtest_results', 'tp_hit')) {
    connection.exec('ALTER TABLE backtest_results ADD COLUMN tp_hit INTEGER DEFAULT 0');
  }

  if (!hasColumn(connection, 'backtest_results', 'sl_hit')) {
    connection.exec('ALTER TABLE backtest_results ADD COLUMN sl_hit INTEGER DEFAULT 0');
  }

  const stockBasicsColumns = [
    { name: 'industry', sql: 'TEXT' },
    { name: 'latest_price', sql: 'REAL' },
    { name: 'total_shares', sql: 'REAL' },
    { name: 'float_shares', sql: 'REAL' },
    { name: 'total_market_cap', sql: 'REAL' },
    { name: 'float_market_cap', sql: 'REAL' },
    { name: 'listing_date', sql: 'TEXT' },
    { name: 'main_business', sql: 'TEXT' },
    { name: 'business_scope', sql: 'TEXT' },
    { name: 'company_profile', sql: 'TEXT' },
    { name: 'trading_hours', sql: 'TEXT' },
    { name: 'fundamentals_source', sql: 'TEXT' },
    { name: 'fundamentals_synced_at', sql: 'TEXT' },
  ];

  stockBasicsColumns.forEach((column) => {
    if (!hasColumn(connection, 'stock_basics', column.name)) {
      connection.exec(`ALTER TABLE stock_basics ADD COLUMN ${column.name} ${column.sql}`);
    }
  });

  if (hasTable(connection, 'futures_categories') && !hasColumn(connection, 'futures_categories', 'is_enabled')) {
    connection.exec('ALTER TABLE futures_categories ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1');
  }

  if (hasTable(connection, 'stock_monitor_categories') && !hasColumn(connection, 'stock_monitor_categories', 'is_enabled')) {
    connection.exec('ALTER TABLE stock_monitor_categories ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1');
  }

  if (hasTable(connection, 'monitor_categories') && !hasColumn(connection, 'monitor_categories', 'is_enabled')) {
    connection.exec('ALTER TABLE monitor_categories ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1');
  }

  if (!hasColumn(connection, 'news_items', 'meta_json')) {
    connection.exec('ALTER TABLE news_items ADD COLUMN meta_json TEXT');
  }

  if (!hasColumn(connection, 'news_provider_categories', 'scheduler_enabled')) {
    connection.exec('ALTER TABLE news_provider_categories ADD COLUMN scheduler_enabled INTEGER NOT NULL DEFAULT 1');
  }

  if (!hasColumn(connection, 'news_provider_categories', 'scheduler_priority')) {
    connection.exec('ALTER TABLE news_provider_categories ADD COLUMN scheduler_priority INTEGER NOT NULL DEFAULT 100');
  }

  if (hasTable(connection, 'news_scheduler_states')) {
    if (!hasColumn(connection, 'news_scheduler_states', 'round_robin_cursor')) {
      connection.exec('ALTER TABLE news_scheduler_states ADD COLUMN round_robin_cursor INTEGER NOT NULL DEFAULT 0');
    }
    if (!hasColumn(connection, 'news_scheduler_states', 'last_catalog_sync_at')) {
      connection.exec('ALTER TABLE news_scheduler_states ADD COLUMN last_catalog_sync_at INTEGER NOT NULL DEFAULT 0');
    }
    if (!hasColumn(connection, 'news_scheduler_states', 'retry_state_json')) {
      connection.exec('ALTER TABLE news_scheduler_states ADD COLUMN retry_state_json TEXT');
    }
    if (!hasColumn(connection, 'news_scheduler_states', 'last_tick_at')) {
      connection.exec('ALTER TABLE news_scheduler_states ADD COLUMN last_tick_at TEXT');
    }
    if (!hasColumn(connection, 'news_scheduler_states', 'last_result_json')) {
      connection.exec('ALTER TABLE news_scheduler_states ADD COLUMN last_result_json TEXT');
    }
  }

  ensureMarketMetricRuleDefaults(connection);
  migrateLegacyMonitorConfig(connection);
  migrateLegacyStockDailyBars(connection);
  normalizeStockEodBarsForTradeDayUniq(connection);
  ensureMarketDataPerformanceIndexes(connection);
  dropLegacyMonitorTables(connection);
}

function seedDefaults(connection) {
  const user = connection.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!user) {
    const hash = bcrypt.hashSync('admin123456', 10);
    connection
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run('admin', hash);
  }

  connection.prepare(`
    INSERT INTO auth_settings (id, auth_enabled, password_changeable, updated_at)
    VALUES (1, 0, 1, datetime('now'))
    ON CONFLICT(id) DO NOTHING
  `).run();

  const insertConfig = connection.prepare(`
    INSERT INTO system_configs (key, value, category, title, description, updated_at)
    VALUES (@key, @value, @category, @title, @description, datetime('now'))
    ON CONFLICT(key) DO NOTHING
  `);

  const tx = connection.transaction((items) => {
    items.forEach((item) => insertConfig.run(item));
  });
  tx(DEFAULT_SYSTEM_CONFIGS);

  connection.prepare(`
    INSERT INTO a_share_market_metric_rules (
      rule_key, name, scope_key, price_mode,
      exclude_suspended, min_listing_trading_days, include_st,
      min_sample_size, is_enabled, is_default, created_at, updated_at
    )
    VALUES (
      'ALL_A_CLOSE_RAW_V1', '全A不复权收盘价V1', 'ALL_A', 'close_raw',
      1, 0, 1,
      1, 1, 1, datetime('now'), datetime('now')
    )
    ON CONFLICT(rule_key) DO NOTHING
  `).run();

  connection.prepare(`
    INSERT INTO monitor_categories (name, description, sort_order, is_enabled, created_at, updated_at)
    VALUES ('自选监控', '统一监控默认分类', 10, 1, datetime('now'), datetime('now'))
    ON CONFLICT(name) DO NOTHING
  `).run();

  const unifiedWatchlist = connection.prepare('SELECT id FROM monitor_categories WHERE name = ?').get('自选监控');
  if (unifiedWatchlist?.id) {
    connection.prepare(`
      INSERT INTO monitor_symbols (
        category_id, symbol_code, quote_code, symbol_type, market, exchange, display_name, sort_order, is_active, created_at, updated_at
      )
      VALUES (?, '600519', '600519', 'stock', 'A', NULL, '贵州茅台', 10, 1, datetime('now'), datetime('now'))
      ON CONFLICT(category_id, symbol_type, market, symbol_code) DO NOTHING
    `).run(unifiedWatchlist.id);
  }

  connection.prepare(`
    INSERT INTO monitor_categories (name, description, sort_order, is_enabled, created_at, updated_at)
    VALUES ('期货-有色金属', '默认有色期货观察分类', 20, 1, datetime('now'), datetime('now'))
    ON CONFLICT(name) DO NOTHING
  `).run();

  const unifiedFutures = connection.prepare('SELECT id FROM monitor_categories WHERE name = ?').get('期货-有色金属');
  if (unifiedFutures?.id) {
    connection.prepare(`
      INSERT INTO monitor_symbols (
        category_id, symbol_code, quote_code, symbol_type, market, exchange, display_name, sort_order, is_active, created_at, updated_at
      )
      VALUES (?, 'SI00Y', '101.SI00Y', 'futures', 'FUTURES_101', NULL, '白银主连', 10, 1, datetime('now'), datetime('now'))
      ON CONFLICT(category_id, symbol_type, market, symbol_code) DO NOTHING
    `).run(unifiedFutures.id);
  }

  connection.prepare(`
    INSERT INTO bluechip_pools (code, name, description, sort_order, is_enabled, created_at, updated_at)
    VALUES ('SH_SAMPLE', '上证示例池', '默认上证示例标的池', 10, 1, datetime('now'), datetime('now'))
    ON CONFLICT(code) DO NOTHING
  `).run();
  connection.prepare(`
    INSERT INTO bluechip_pools (code, name, description, sort_order, is_enabled, created_at, updated_at)
    VALUES ('SZ_SAMPLE', '深证示例池', '默认深证示例标的池', 20, 1, datetime('now'), datetime('now'))
    ON CONFLICT(code) DO NOTHING
  `).run();
  connection.prepare(`
    INSERT INTO bluechip_pools (code, name, description, sort_order, is_enabled, created_at, updated_at)
    VALUES ('HS300_SAMPLE', '沪深300示例池', '默认沪深300示例标的池', 30, 1, datetime('now'), datetime('now'))
    ON CONFLICT(code) DO NOTHING
  `).run();
  connection.prepare(`
    INSERT INTO bluechip_pools (code, name, description, sort_order, is_enabled, created_at, updated_at)
    VALUES ('KC50_ALL', '科创50成分股', '科创50成分股（初始化）', 40, 1, datetime('now'), datetime('now'))
    ON CONFLICT(code) DO NOTHING
  `).run();

  const shSample = connection.prepare('SELECT id FROM bluechip_pools WHERE code = ?').get('SH_SAMPLE');
  if (shSample?.id) {
    ['600519', '600036', '600000', '600887', '601318', '601888', '600900', '600276'].forEach((code, index) => {
      connection.prepare(`
        INSERT INTO bluechip_pool_symbols (
          pool_id, stock_code, stock_name, sort_order, is_active, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, 1, datetime('now'), datetime('now'))
        ON CONFLICT(pool_id, stock_code) DO NOTHING
      `).run(shSample.id, code, (index + 1) * 10);
    });
  }

  const szSample = connection.prepare('SELECT id FROM bluechip_pools WHERE code = ?').get('SZ_SAMPLE');
  if (szSample?.id) {
    ['000001', '000333', '000858', '002415', '002594', '300750', '300059', '002142'].forEach((code, index) => {
      connection.prepare(`
        INSERT INTO bluechip_pool_symbols (
          pool_id, stock_code, stock_name, sort_order, is_active, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, 1, datetime('now'), datetime('now'))
        ON CONFLICT(pool_id, stock_code) DO NOTHING
      `).run(szSample.id, code, (index + 1) * 10);
    });
  }

  const hs300Sample = connection.prepare('SELECT id FROM bluechip_pools WHERE code = ?').get('HS300_SAMPLE');
  if (hs300Sample?.id) {
    ['600519', '601318', '600036', '600276', '000333', '000858', '300750', '002415', '601888', '600900'].forEach((code, index) => {
      connection.prepare(`
        INSERT INTO bluechip_pool_symbols (
          pool_id, stock_code, stock_name, sort_order, is_active, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, 1, datetime('now'), datetime('now'))
        ON CONFLICT(pool_id, stock_code) DO NOTHING
      `).run(hs300Sample.id, code, (index + 1) * 10);
    });
  }

  const kc50Pool = connection.prepare('SELECT id FROM bluechip_pools WHERE code = ?').get('KC50_ALL');
  if (kc50Pool?.id) {
    [
      '688008', '688009', '688012', '688027', '688036', '688041', '688047', '688065', '688072', '688082',
      '688099', '688111', '688114', '688120', '688122', '688126', '688169', '688183', '688187', '688188',
      '688213', '688220', '688223', '688234', '688249', '688256', '688271', '688278', '688297', '688303',
      '688349', '688361', '688375', '688396', '688469', '688472', '688506', '688521', '688525', '688538',
      '688568', '688578', '688599', '688608', '688617', '688702', '688728', '688777', '688981', '689009',
    ].forEach((code, index) => {
      connection.prepare(`
        INSERT INTO bluechip_pool_symbols (
          pool_id, stock_code, stock_name, sort_order, is_active, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, 1, datetime('now'), datetime('now'))
        ON CONFLICT(pool_id, stock_code) DO NOTHING
      `).run(kc50Pool.id, code, (index + 1) * 10);
    });
  }

  connection.prepare(`
    INSERT INTO news_providers (provider_key, name, enabled, priority, config_json, created_at, updated_at)
    VALUES ('tushare', 'Tushare 资讯源', 1, 10, '{}', datetime('now'), datetime('now'))
    ON CONFLICT(provider_key) DO NOTHING
  `).run();

  const now = "datetime('now')";
  connection.prepare(`
    INSERT INTO news_taxonomies (
      taxonomy_key, parent_taxonomy_key, name, level, sort_order, is_active, description, meta_json, created_at, updated_at
    ) VALUES
      ('news.root', NULL, '资讯总览', 1, 10, 1, '焦点资讯顶层分类', '{}', ${now}, ${now}),
      ('news.macro', 'news.root', '宏观政策', 2, 20, 1, '宏观与政策相关资讯', '{}', ${now}, ${now}),
      ('news.flash', 'news.root', '市场快讯', 2, 30, 1, '盘中快讯与短新闻', '{}', ${now}, ${now}),
      ('news.announcement', 'news.root', '上市公司公告', 2, 40, 1, '上市公司公告与披露', '{}', ${now}, ${now}),
      ('news.interaction', 'news.root', '交易所互动', 2, 50, 1, '投资者问答与互动平台资讯', '{}', ${now}, ${now}),
      ('news.industry', 'news.root', '行业与主题', 2, 60, 1, '行业、主题、赛道资讯', '{}', ${now}, ${now})
    ON CONFLICT(taxonomy_key) DO NOTHING
  `).run();
}

export function getDb() {
  if (!db) {
    ensureDataDir();
    db = new Database(env.DB_PATH);
    createSchema(db);
    ensureMigrations(db);
    seedDefaults(db);
  }
  return db;
}

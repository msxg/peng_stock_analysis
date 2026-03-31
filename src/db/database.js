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

    CREATE TABLE IF NOT EXISTS futures_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 100,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS futures_symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      quote_code TEXT NOT NULL,
      market INTEGER NOT NULL,
      code TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 100,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES futures_categories(id) ON DELETE CASCADE,
      UNIQUE (category_id, market, code)
    );

    CREATE INDEX IF NOT EXISTS idx_futures_symbols_category ON futures_symbols (category_id, sort_order ASC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_futures_symbols_active ON futures_symbols (is_active, sort_order ASC, id ASC);

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

    CREATE TABLE IF NOT EXISTS stock_monitor_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 100,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stock_monitor_symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      stock_code TEXT NOT NULL,
      market TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 100,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES stock_monitor_categories(id) ON DELETE CASCADE,
      UNIQUE (category_id, market, stock_code)
    );

    CREATE INDEX IF NOT EXISTS idx_stock_monitor_symbols_category ON stock_monitor_symbols (category_id, sort_order ASC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_stock_monitor_symbols_active ON stock_monitor_symbols (is_active, sort_order ASC, id ASC);

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

  if (!hasColumn(connection, 'futures_categories', 'is_enabled')) {
    connection.exec('ALTER TABLE futures_categories ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1');
  }

  if (!hasColumn(connection, 'stock_monitor_categories', 'is_enabled')) {
    connection.exec('ALTER TABLE stock_monitor_categories ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1');
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
    INSERT INTO futures_categories (name, description, sort_order, created_at, updated_at)
    VALUES ('有色金属', '默认有色期货观察分类', 10, datetime('now'), datetime('now'))
    ON CONFLICT(name) DO NOTHING
  `).run();

  const nonFerrous = connection.prepare('SELECT id FROM futures_categories WHERE name = ?').get('有色金属');
  if (nonFerrous?.id) {
    connection.prepare(`
      INSERT INTO futures_symbols (
        category_id, name, quote_code, market, code, sort_order, is_active, created_at, updated_at
      )
      VALUES (?, '白银主连', '101.SI00Y', 101, 'SI00Y', 10, 1, datetime('now'), datetime('now'))
      ON CONFLICT(category_id, market, code) DO NOTHING
    `).run(nonFerrous.id);
  }

  connection.prepare(`
    INSERT INTO stock_monitor_categories (name, description, sort_order, created_at, updated_at)
    VALUES ('自选股票', '默认股票监测分类', 10, datetime('now'), datetime('now'))
    ON CONFLICT(name) DO NOTHING
  `).run();

  const watchlist = connection.prepare('SELECT id FROM stock_monitor_categories WHERE name = ?').get('自选股票');
  if (watchlist?.id) {
    connection.prepare(`
      INSERT INTO stock_monitor_symbols (
        category_id, name, stock_code, market, sort_order, is_active, created_at, updated_at
      )
      VALUES (?, '贵州茅台', '600519', 'A', 10, 1, datetime('now'), datetime('now'))
      ON CONFLICT(category_id, market, stock_code) DO NOTHING
    `).run(watchlist.id);
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

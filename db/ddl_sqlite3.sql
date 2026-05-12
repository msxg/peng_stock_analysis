-- SQLite3 DDL
-- 说明：
-- 1. SQLite 不支持 MySQL 风格的 COMMENT 语法
-- 2. 本文件通过标准 SQL 注释（--）为表和字段补充说明
-- 3. 可直接用于 SQLite 建库执行

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- =====================================
-- 模块：认证与系统配置
-- =====================================

-- 表：users
-- 说明：后台登录用户表
CREATE TABLE IF NOT EXISTS users (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 用户名，唯一
  username TEXT NOT NULL UNIQUE,
  -- 密码哈希
  password_hash TEXT NOT NULL,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 表：auth_settings
-- 说明：系统级认证开关配置，约定只有一条记录，id 固定为 1
CREATE TABLE IF NOT EXISTS auth_settings (
  -- 固定主键，值恒为 1
  id INTEGER PRIMARY KEY CHECK (id = 1),
  -- 是否开启认证：0-关闭，1-开启
  auth_enabled INTEGER NOT NULL DEFAULT 0,
  -- 是否允许修改密码：0-否，1-是
  password_changeable INTEGER NOT NULL DEFAULT 1,
  -- 更新时间
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 表：system_configs
-- 说明：系统配置中心，保存行情源、邮件、LLM 等配置项
CREATE TABLE IF NOT EXISTS system_configs (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 配置键，唯一
  key TEXT NOT NULL UNIQUE,
  -- 配置值
  value TEXT,
  -- 配置分类
  category TEXT NOT NULL,
  -- 配置标题
  title TEXT,
  -- 配置描述
  description TEXT,
  -- 更新时间
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =====================================
-- 模块：通用股票分析与回测
-- =====================================

-- 表：analysis_tasks
-- 说明：异步分析任务状态表
CREATE TABLE IF NOT EXISTS analysis_tasks (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 任务唯一标识
  task_id TEXT NOT NULL UNIQUE,
  -- 同一批次分析的查询编号
  query_id TEXT,
  -- 股票代码列表，通常为序列化文本
  stock_codes TEXT NOT NULL,
  -- 任务状态
  status TEXT NOT NULL,
  -- 任务参数JSON
  params TEXT,
  -- 任务结果JSON
  result TEXT,
  -- 错误信息
  error TEXT,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 更新时间
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 完成时间
  completed_at TEXT
);

-- 表：analysis_history
-- 说明：单只股票分析结果与报告历史
CREATE TABLE IF NOT EXISTS analysis_history (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 分析批次查询编号
  query_id TEXT,
  -- 股票代码
  stock_code TEXT NOT NULL,
  -- 股票名称
  stock_name TEXT,
  -- 市场标识
  market TEXT,
  -- 分析日期
  analysis_date TEXT NOT NULL,
  -- 分析摘要
  summary TEXT,
  -- 操作建议
  recommendation TEXT,
  -- 建议买入价
  buy_price REAL,
  -- 建议止损价
  stop_loss REAL,
  -- 建议目标价
  target_price REAL,
  -- 置信度
  confidence REAL,
  -- 技术面原始结果JSON
  technical_payload TEXT,
  -- 资讯面原始结果JSON
  news_payload TEXT,
  -- Markdown 报告正文
  report_markdown TEXT NOT NULL,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引：按股票代码和分析日期倒序查询历史
CREATE INDEX IF NOT EXISTS idx_history_stock_date
  ON analysis_history (stock_code, analysis_date DESC);

-- 索引：按 query_id 查询同批次结果
CREATE INDEX IF NOT EXISTS idx_history_query
  ON analysis_history (query_id);

-- 表：backtest_results
-- 说明：分析结果回测评估表
CREATE TABLE IF NOT EXISTS backtest_results (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 关联分析历史ID
  analysis_id INTEGER NOT NULL,
  -- 股票代码
  stock_code TEXT NOT NULL,
  -- 回测评估天数
  evaluation_days INTEGER NOT NULL,
  -- 起始价格
  start_price REAL,
  -- 结束价格
  end_price REAL,
  -- 收益率
  return_pct REAL,
  -- 方向是否命中
  direction_hit INTEGER,
  -- 是否命中止盈
  tp_hit INTEGER DEFAULT 0,
  -- 是否命中止损
  sl_hit INTEGER DEFAULT 0,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (analysis_id) REFERENCES analysis_history(id) ON DELETE CASCADE
);

-- 索引：按分析记录和评估周期查询回测结果
CREATE INDEX IF NOT EXISTS idx_backtest_analysis
  ON backtest_results (analysis_id, evaluation_days);

-- =====================================
-- 模块：持仓管理
-- =====================================

-- 表：portfolio_accounts
-- 说明：投资账户主表
CREATE TABLE IF NOT EXISTS portfolio_accounts (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 账户名称
  name TEXT NOT NULL,
  -- 基础币种
  base_currency TEXT NOT NULL DEFAULT 'CNY',
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 更新时间
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 表：portfolio_trades
-- 说明：账户成交流水
CREATE TABLE IF NOT EXISTS portfolio_trades (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 关联账户ID
  account_id INTEGER NOT NULL,
  -- 股票代码
  stock_code TEXT NOT NULL,
  -- 市场标识
  market TEXT,
  -- 买卖方向
  side TEXT NOT NULL,
  -- 成交数量
  quantity REAL NOT NULL,
  -- 成交价格
  price REAL NOT NULL,
  -- 手续费
  fee REAL NOT NULL DEFAULT 0,
  -- 交易日期
  trade_date TEXT NOT NULL,
  -- 备注
  note TEXT,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES portfolio_accounts(id) ON DELETE CASCADE
);

-- 表：portfolio_cash_ledger
-- 说明：账户资金收支流水
CREATE TABLE IF NOT EXISTS portfolio_cash_ledger (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 关联账户ID
  account_id INTEGER NOT NULL,
  -- 资金流水类型
  type TEXT NOT NULL,
  -- 发生金额
  amount REAL NOT NULL,
  -- 币种
  currency TEXT NOT NULL DEFAULT 'CNY',
  -- 发生时间
  occurred_at TEXT NOT NULL,
  -- 备注
  note TEXT,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES portfolio_accounts(id) ON DELETE CASCADE
);

-- 表：portfolio_corporate_actions
-- 说明：账户对应证券的公司行为记录
CREATE TABLE IF NOT EXISTS portfolio_corporate_actions (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 关联账户ID
  account_id INTEGER NOT NULL,
  -- 股票代码
  stock_code TEXT NOT NULL,
  -- 公司行为类型
  action_type TEXT NOT NULL,
  -- 比例参数
  ratio REAL,
  -- 现金金额
  cash_amount REAL,
  -- 生效日期
  effective_date TEXT NOT NULL,
  -- 备注
  note TEXT,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES portfolio_accounts(id) ON DELETE CASCADE
);

-- =====================================
-- 模块：期货监测
-- =====================================

-- 表：futures_categories
-- 说明：期货监测分类
CREATE TABLE IF NOT EXISTS futures_categories (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 分类名称，唯一
  name TEXT NOT NULL UNIQUE,
  -- 分类描述
  description TEXT,
  -- 排序值
  sort_order INTEGER NOT NULL DEFAULT 100,
  -- 是否启用：0-否，1-是
  is_enabled INTEGER NOT NULL DEFAULT 1,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 更新时间
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 表：futures_symbols
-- 说明：期货分类下的监测标的
CREATE TABLE IF NOT EXISTS futures_symbols (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 分类ID
  category_id INTEGER NOT NULL,
  -- 展示名称
  name TEXT NOT NULL,
  -- 行情代码
  quote_code TEXT NOT NULL,
  -- 市场编号
  market INTEGER NOT NULL,
  -- 合约代码
  code TEXT NOT NULL,
  -- 排序值
  sort_order INTEGER NOT NULL DEFAULT 100,
  -- 是否激活：0-否，1-是
  is_active INTEGER NOT NULL DEFAULT 1,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 更新时间
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES futures_categories(id) ON DELETE CASCADE,
  UNIQUE (category_id, market, code)
);

-- 索引：按分类读取期货标的
CREATE INDEX IF NOT EXISTS idx_futures_symbols_category
  ON futures_symbols (category_id, sort_order ASC, id ASC);

-- 索引：按激活状态读取期货标的
CREATE INDEX IF NOT EXISTS idx_futures_symbols_active
  ON futures_symbols (is_active, sort_order ASC, id ASC);

-- 表：futures_basics
-- 说明：期货基础资料缓存
CREATE TABLE IF NOT EXISTS futures_basics (
  -- 行情代码，主键
  quote_code TEXT PRIMARY KEY,
  -- 市场编号
  market INTEGER,
  -- 合约代码
  code TEXT NOT NULL,
  -- 名称
  name TEXT,
  -- 交易所
  exchange TEXT,
  -- 交易时段
  trading_hours TEXT,
  -- 数据来源
  source TEXT,
  -- 同步时间
  synced_at TEXT,
  -- 更新时间
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引：按 code 查询期货基础资料
CREATE INDEX IF NOT EXISTS idx_futures_basics_code
  ON futures_basics (code);

-- 表：futures_intraday_bars
-- 说明：期货分时/分钟K线数据
CREATE TABLE IF NOT EXISTS futures_intraday_bars (
  -- 行情代码
  quote_code TEXT NOT NULL,
  -- 周期，例如 1m/5m
  timeframe TEXT NOT NULL,
  -- 交易日
  trade_day TEXT NOT NULL,
  -- 时间桶时间戳
  bucket_ts INTEGER NOT NULL,
  -- 行情时间文本
  date TEXT NOT NULL,
  -- 开盘价
  open REAL,
  -- 最高价
  high REAL,
  -- 最低价
  low REAL,
  -- 收盘价
  close REAL,
  -- 成交量
  volume REAL NOT NULL DEFAULT 0,
  -- 成交额
  amount REAL NOT NULL DEFAULT 0,
  -- 数据来源
  source TEXT,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 更新时间
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (quote_code, timeframe, bucket_ts)
);

-- 索引：按合约、周期、交易日和时间桶查询K线
CREATE INDEX IF NOT EXISTS idx_futures_intraday_lookup
  ON futures_intraday_bars (quote_code, timeframe, trade_day, bucket_ts ASC);

-- =====================================
-- 模块：股票基础资料与行情监测
-- =====================================

-- 表：stock_basics
-- 说明：股票基础资料主表
CREATE TABLE IF NOT EXISTS stock_basics (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 市场标识，例如 A/HK/US
  market TEXT NOT NULL,
  -- 子市场标识
  sub_market TEXT,
  -- 股票代码
  code TEXT NOT NULL,
  -- 股票名称
  name TEXT NOT NULL,
  -- 板块
  sector TEXT,
  -- 行业
  industry TEXT,
  -- 最新价格
  latest_price REAL,
  -- 总股本
  total_shares REAL,
  -- 流通股本
  float_shares REAL,
  -- 总市值
  total_market_cap REAL,
  -- 流通市值
  float_market_cap REAL,
  -- 上市日期
  listing_date TEXT,
  -- 主营业务
  main_business TEXT,
  -- 经营范围
  business_scope TEXT,
  -- 公司简介
  company_profile TEXT,
  -- 交易时段
  trading_hours TEXT,
  -- 基本面数据来源
  fundamentals_source TEXT,
  -- 基本面同步时间
  fundamentals_synced_at TEXT,
  -- 数据来源
  source TEXT,
  -- 最近同步时间
  synced_at TEXT,
  -- 更新时间
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (market, code)
);

-- 索引：按市场和代码查询股票基础资料
CREATE INDEX IF NOT EXISTS idx_stock_basics_market_code
  ON stock_basics (market, code);

-- 索引：按名称查询股票基础资料
CREATE INDEX IF NOT EXISTS idx_stock_basics_name
  ON stock_basics (name);

-- 表：stock_monitor_categories
-- 说明：股票行情监测分类
CREATE TABLE IF NOT EXISTS stock_monitor_categories (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 分类名称，唯一
  name TEXT NOT NULL UNIQUE,
  -- 分类描述
  description TEXT,
  -- 排序值
  sort_order INTEGER NOT NULL DEFAULT 100,
  -- 是否启用：0-否，1-是
  is_enabled INTEGER NOT NULL DEFAULT 1,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 更新时间
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 表：stock_monitor_symbols
-- 说明：股票监测分类下的股票列表
CREATE TABLE IF NOT EXISTS stock_monitor_symbols (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 分类ID
  category_id INTEGER NOT NULL,
  -- 展示名称
  name TEXT NOT NULL,
  -- 股票代码
  stock_code TEXT NOT NULL,
  -- 市场标识
  market TEXT NOT NULL,
  -- 排序值
  sort_order INTEGER NOT NULL DEFAULT 100,
  -- 是否激活：0-否，1-是
  is_active INTEGER NOT NULL DEFAULT 1,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 更新时间
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES stock_monitor_categories(id) ON DELETE CASCADE,
  UNIQUE (category_id, market, stock_code)
);

-- 索引：按分类读取股票监测标的
CREATE INDEX IF NOT EXISTS idx_stock_monitor_symbols_category
  ON stock_monitor_symbols (category_id, sort_order ASC, id ASC);

-- 索引：按激活状态读取股票监测标的
CREATE INDEX IF NOT EXISTS idx_stock_monitor_symbols_active
  ON stock_monitor_symbols (is_active, sort_order ASC, id ASC);

-- =====================================
-- 模块：蓝筹模式与标的池
-- =====================================

-- 表：bluechip_pools
-- 说明：蓝筹模式标的池主表
CREATE TABLE IF NOT EXISTS bluechip_pools (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 标的池编码，唯一
  code TEXT NOT NULL UNIQUE,
  -- 标的池名称，唯一
  name TEXT NOT NULL UNIQUE,
  -- 描述
  description TEXT,
  -- 排序值
  sort_order INTEGER NOT NULL DEFAULT 100,
  -- 是否启用：0-否，1-是
  is_enabled INTEGER NOT NULL DEFAULT 1,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 更新时间
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 表：bluechip_pool_symbols
-- 说明：标的池成分股表
CREATE TABLE IF NOT EXISTS bluechip_pool_symbols (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 关联标的池ID
  pool_id INTEGER NOT NULL,
  -- 股票代码
  stock_code TEXT NOT NULL,
  -- 股票名称
  stock_name TEXT,
  -- 排序值
  sort_order INTEGER NOT NULL DEFAULT 100,
  -- 是否激活：0-否，1-是
  is_active INTEGER NOT NULL DEFAULT 1,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 更新时间
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pool_id) REFERENCES bluechip_pools(id) ON DELETE CASCADE,
  UNIQUE (pool_id, stock_code)
);

-- 索引：按标的池读取成分股
CREATE INDEX IF NOT EXISTS idx_bluechip_pool_symbols_pool
  ON bluechip_pool_symbols (pool_id, sort_order ASC, id ASC);

-- 索引：按激活状态读取成分股
CREATE INDEX IF NOT EXISTS idx_bluechip_pool_symbols_active
  ON bluechip_pool_symbols (is_active, sort_order ASC, id ASC);

-- 表：bluechip_analysis_signals
-- 说明：蓝筹批量分析信号保存表，只存信号列表快照
CREATE TABLE IF NOT EXISTS bluechip_analysis_signals (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 保存批次ID
  batch_id TEXT NOT NULL,
  -- 分析模式：today/history
  analysis_mode TEXT NOT NULL,
  -- 来源模式：manual/pool
  source_mode TEXT NOT NULL,
  -- 标的池ID（可空，manual 模式下通常为空）
  pool_id INTEGER,
  -- 标的池编码
  pool_code TEXT,
  -- 标的池名称
  pool_name TEXT,
  -- 指数代码
  index_code TEXT,
  -- 指数名称
  index_name TEXT,
  -- 本次分析日期
  analysis_date TEXT NOT NULL,
  -- 信号触发日期
  signal_date TEXT NOT NULL,
  -- 股票代码
  stock_code TEXT NOT NULL,
  -- 股票名称
  stock_name TEXT,
  -- 信号方向：buy/sell
  signal_side TEXT NOT NULL,
  -- 信号类型
  signal_type TEXT NOT NULL,
  -- 信号价格
  signal_price REAL,
  -- 信号原因
  signal_reason TEXT,
  -- 信号对应盈亏百分比
  signal_pnl_pct REAL,
  -- 参数快照JSON
  params_json TEXT,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引：按批次查询保存结果
CREATE INDEX IF NOT EXISTS idx_bluechip_analysis_signals_batch
  ON bluechip_analysis_signals (batch_id, id ASC);

-- 索引：按分析日期倒序查询
CREATE INDEX IF NOT EXISTS idx_bluechip_analysis_signals_analysis_date
  ON bluechip_analysis_signals (analysis_date DESC, id DESC);

-- 索引：按信号日期倒序查询
CREATE INDEX IF NOT EXISTS idx_bluechip_analysis_signals_signal_date
  ON bluechip_analysis_signals (signal_date DESC, id DESC);

-- 索引：按股票代码和信号日期查询
CREATE INDEX IF NOT EXISTS idx_bluechip_analysis_signals_stock
  ON bluechip_analysis_signals (stock_code, signal_date DESC, id DESC);

-- 索引：按标的池和分析日期查询
CREATE INDEX IF NOT EXISTS idx_bluechip_analysis_signals_pool
  ON bluechip_analysis_signals (pool_code, analysis_date DESC, id DESC);

-- =====================================
-- 模块：AI 对话与用量
-- =====================================

-- 表：chat_sessions
-- 说明：AI 对话会话主表
CREATE TABLE IF NOT EXISTS chat_sessions (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 会话唯一标识
  session_id TEXT NOT NULL UNIQUE,
  -- 用户标识
  user_id TEXT,
  -- 会话标题
  title TEXT,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 更新时间
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 表：chat_messages
-- 说明：AI 对话消息明细
CREATE TABLE IF NOT EXISTS chat_messages (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 会话ID
  session_id TEXT NOT NULL,
  -- 消息角色：user/assistant/system
  role TEXT NOT NULL,
  -- 消息内容
  content TEXT NOT NULL,
  -- 附加元数据JSON
  metadata TEXT,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES chat_sessions(session_id) ON DELETE CASCADE
);

-- 表：usage_logs
-- 说明：模型调用与成本统计日志
CREATE TABLE IF NOT EXISTS usage_logs (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 事件类型
  event_type TEXT NOT NULL,
  -- 模型名称
  model TEXT,
  -- 输入Token数
  token_in INTEGER DEFAULT 0,
  -- 输出Token数
  token_out INTEGER DEFAULT 0,
  -- 费用
  cost REAL DEFAULT 0,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =====================================
-- 模块：焦点资讯
-- =====================================

-- 表：news_providers
-- 说明：资讯源注册表
CREATE TABLE IF NOT EXISTS news_providers (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 资讯源唯一键
  provider_key TEXT NOT NULL UNIQUE,
  -- 资讯源名称
  name TEXT NOT NULL,
  -- 是否启用：0-否，1-是
  enabled INTEGER NOT NULL DEFAULT 1,
  -- 优先级，值越小越优先
  priority INTEGER NOT NULL DEFAULT 100,
  -- 配置JSON
  config_json TEXT,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 更新时间
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 表：news_provider_categories
-- 说明：三方资讯源原始分类树
CREATE TABLE IF NOT EXISTS news_provider_categories (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 资讯源唯一键
  provider_key TEXT NOT NULL,
  -- 分类唯一键
  category_key TEXT NOT NULL,
  -- 父分类唯一键
  parent_category_key TEXT,
  -- 分类名称
  name TEXT NOT NULL,
  -- 层级
  level INTEGER NOT NULL DEFAULT 1,
  -- 排序值
  sort_order INTEGER NOT NULL DEFAULT 100,
  -- 是否启用：0-否，1-是
  is_active INTEGER NOT NULL DEFAULT 1,
  -- 调度器是否启用：0-否，1-是
  scheduler_enabled INTEGER NOT NULL DEFAULT 1,
  -- 调度优先级
  scheduler_priority INTEGER NOT NULL DEFAULT 100,
  -- 扩展元数据JSON
  meta_json TEXT,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 更新时间
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider_key, category_key)
);

-- 索引：按资讯源和父分类查询分类树
CREATE INDEX IF NOT EXISTS idx_news_provider_categories_parent
  ON news_provider_categories (provider_key, parent_category_key, sort_order ASC, id ASC);

-- 表：news_taxonomies
-- 说明：系统内部统一资讯分类体系
CREATE TABLE IF NOT EXISTS news_taxonomies (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- taxonomy 唯一键
  taxonomy_key TEXT NOT NULL UNIQUE,
  -- 父 taxonomy 键
  parent_taxonomy_key TEXT,
  -- 分类名称
  name TEXT NOT NULL,
  -- 层级
  level INTEGER NOT NULL DEFAULT 1,
  -- 排序值
  sort_order INTEGER NOT NULL DEFAULT 100,
  -- 是否启用：0-否，1-是
  is_active INTEGER NOT NULL DEFAULT 1,
  -- 描述
  description TEXT,
  -- 元数据JSON
  meta_json TEXT,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 更新时间
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引：按父 taxonomy 查询分类树
CREATE INDEX IF NOT EXISTS idx_news_taxonomies_parent
  ON news_taxonomies (parent_taxonomy_key, sort_order ASC, id ASC);

-- 表：news_taxonomy_mappings
-- 说明：资讯源分类到内部 taxonomy 的映射关系
CREATE TABLE IF NOT EXISTS news_taxonomy_mappings (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 资讯源唯一键
  provider_key TEXT NOT NULL,
  -- 资讯源分类键
  provider_category_key TEXT NOT NULL,
  -- 内部 taxonomy 键
  taxonomy_key TEXT NOT NULL,
  -- 映射类型，例如 auto/manual
  mapping_type TEXT NOT NULL DEFAULT 'auto',
  -- 置信度
  confidence REAL NOT NULL DEFAULT 0.8,
  -- 是否人工映射：0-否，1-是
  is_manual INTEGER NOT NULL DEFAULT 0,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 更新时间
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider_key, provider_category_key, taxonomy_key)
);

-- 索引：按 taxonomy 反查外部分类映射
CREATE INDEX IF NOT EXISTS idx_news_taxonomy_mappings_taxonomy
  ON news_taxonomy_mappings (taxonomy_key, provider_key, provider_category_key);

-- 表：news_sync_runs
-- 说明：资讯同步任务运行记录
CREATE TABLE IF NOT EXISTS news_sync_runs (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 同步运行唯一ID
  run_id TEXT NOT NULL UNIQUE,
  -- 资讯源唯一键
  provider_key TEXT NOT NULL,
  -- 分类键
  category_key TEXT,
  -- 触发类型，例如 manual/scheduler
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  -- 运行状态
  status TEXT NOT NULL DEFAULT 'queued',
  -- 同步模式，例如 catalog/items
  sync_mode TEXT NOT NULL DEFAULT 'catalog',
  -- 时间窗口开始
  window_start TEXT,
  -- 时间窗口结束
  window_end TEXT,
  -- 请求时间
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 开始时间
  started_at TEXT,
  -- 完成时间
  finished_at TEXT,
  -- 原始抓取数量
  raw_count INTEGER NOT NULL DEFAULT 0,
  -- 标准化数量
  normalized_count INTEGER NOT NULL DEFAULT 0,
  -- 新增数量
  inserted_count INTEGER NOT NULL DEFAULT 0,
  -- 更新数量
  updated_count INTEGER NOT NULL DEFAULT 0,
  -- 去重数量
  deduped_count INTEGER NOT NULL DEFAULT 0,
  -- 失败数量
  failed_count INTEGER NOT NULL DEFAULT 0,
  -- 错误信息
  error_message TEXT,
  -- 统计JSON
  stats_json TEXT
);

-- 索引：按资讯源、分类和请求时间查询同步记录
CREATE INDEX IF NOT EXISTS idx_news_sync_runs_provider
  ON news_sync_runs (provider_key, category_key, requested_at DESC, id DESC);

-- 索引：按状态和请求时间查询同步记录
CREATE INDEX IF NOT EXISTS idx_news_sync_runs_status
  ON news_sync_runs (status, requested_at DESC, id DESC);

-- 表：news_scheduler_states
-- 说明：资讯调度器状态表
CREATE TABLE IF NOT EXISTS news_scheduler_states (
  -- 资讯源唯一键，主键
  provider_key TEXT NOT NULL PRIMARY KEY,
  -- 轮询游标
  round_robin_cursor INTEGER NOT NULL DEFAULT 0,
  -- 最近一次目录同步时间戳
  last_catalog_sync_at INTEGER NOT NULL DEFAULT 0,
  -- 重试状态JSON
  retry_state_json TEXT,
  -- 最近一次调度时间
  last_tick_at TEXT,
  -- 最近一次调度结果JSON
  last_result_json TEXT,
  -- 更新时间
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 表：news_raw_items
-- 说明：原始资讯抓取落库表，便于排障和回放
CREATE TABLE IF NOT EXISTS news_raw_items (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 同步运行ID
  run_id TEXT NOT NULL,
  -- 资讯源唯一键
  provider_key TEXT NOT NULL,
  -- 三方资讯项ID
  provider_item_id TEXT,
  -- 分类键
  category_key TEXT,
  -- 原始载荷JSON
  payload_json TEXT NOT NULL,
  -- 原始载荷哈希
  payload_hash TEXT,
  -- 发布时间
  published_at TEXT,
  -- 抓取时间
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引：按资讯源和三方ID查询原始数据
CREATE INDEX IF NOT EXISTS idx_news_raw_items_provider_item
  ON news_raw_items (provider_key, provider_item_id, id DESC);

-- 索引：按分类和发布时间查询原始数据
CREATE INDEX IF NOT EXISTS idx_news_raw_items_category_time
  ON news_raw_items (category_key, published_at DESC, id DESC);

-- 索引：按 payload_hash 查询原始去重信息
CREATE INDEX IF NOT EXISTS idx_news_raw_items_hash
  ON news_raw_items (payload_hash);

-- 表：news_items
-- 说明：标准化资讯主表
CREATE TABLE IF NOT EXISTS news_items (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 系统内资讯唯一ID
  news_uid TEXT NOT NULL UNIQUE,
  -- 资讯源唯一键
  provider_key TEXT NOT NULL,
  -- 三方资讯项ID
  provider_item_id TEXT,
  -- 三方分类键
  provider_category_key TEXT,
  -- 规范化标题
  canonical_title TEXT,
  -- 标题
  title TEXT NOT NULL,
  -- 摘要
  summary TEXT,
  -- 正文
  content TEXT,
  -- 原文链接
  url TEXT,
  -- 来源名称
  source_name TEXT,
  -- 作者
  author TEXT,
  -- 语言
  lang TEXT,
  -- 地域
  region TEXT,
  -- 重要性评分
  importance_score REAL NOT NULL DEFAULT 0,
  -- 热度评分
  hot_score REAL NOT NULL DEFAULT 0,
  -- 去重指纹
  dedupe_fingerprint TEXT,
  -- 事件聚合指纹
  event_fingerprint TEXT,
  -- 发布时间
  published_at TEXT,
  -- 入库时间
  ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 首次发现时间
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 最近一次发现时间
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 是否删除：0-否，1-是
  is_deleted INTEGER NOT NULL DEFAULT 0,
  -- 扩展元数据JSON
  meta_json TEXT,
  UNIQUE (provider_key, provider_item_id)
);

-- 索引：按发布时间查询资讯
CREATE INDEX IF NOT EXISTS idx_news_items_published
  ON news_items (published_at DESC, id DESC);

-- 索引：按分类和发布时间查询资讯
CREATE INDEX IF NOT EXISTS idx_news_items_category_published
  ON news_items (provider_category_key, published_at DESC, id DESC);

-- 索引：按重要性和发布时间查询资讯
CREATE INDEX IF NOT EXISTS idx_news_items_importance
  ON news_items (importance_score DESC, published_at DESC, id DESC);

-- 索引：按去重指纹查询
CREATE INDEX IF NOT EXISTS idx_news_items_dedupe
  ON news_items (dedupe_fingerprint);

-- 索引：按事件指纹查询
CREATE INDEX IF NOT EXISTS idx_news_items_event
  ON news_items (event_fingerprint);

-- 表：news_item_taxonomies
-- 说明：资讯与内部 taxonomy 的关联表
CREATE TABLE IF NOT EXISTS news_item_taxonomies (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 资讯唯一ID
  news_uid TEXT NOT NULL,
  -- taxonomy 键
  taxonomy_key TEXT NOT NULL,
  -- 来源，例如 mapping/rule/manual
  source TEXT NOT NULL DEFAULT 'mapping',
  -- 置信度
  confidence REAL NOT NULL DEFAULT 0.8,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (news_uid, taxonomy_key, source)
);

-- 索引：按 taxonomy 查询资讯分类关联
CREATE INDEX IF NOT EXISTS idx_news_item_taxonomies_taxonomy
  ON news_item_taxonomies (taxonomy_key, created_at DESC, id DESC);

-- 表：news_item_entities
-- 说明：资讯实体抽取结果表
CREATE TABLE IF NOT EXISTS news_item_entities (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 资讯唯一ID
  news_uid TEXT NOT NULL,
  -- 实体类型，例如 stock/industry/company
  entity_type TEXT NOT NULL,
  -- 实体键
  entity_key TEXT NOT NULL,
  -- 实体名称
  entity_name TEXT,
  -- 关联关系类型
  relation_type TEXT,
  -- 置信度
  confidence REAL NOT NULL DEFAULT 0.8,
  -- 来源
  source TEXT NOT NULL DEFAULT 'rule',
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引：按实体类型和实体键查询
CREATE INDEX IF NOT EXISTS idx_news_item_entities_entity
  ON news_item_entities (entity_type, entity_key, created_at DESC, id DESC);

-- 索引：按资讯ID查询实体
CREATE INDEX IF NOT EXISTS idx_news_item_entities_news
  ON news_item_entities (news_uid, id DESC);

-- 表：news_clusters
-- 说明：资讯聚类主题表
CREATE TABLE IF NOT EXISTS news_clusters (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 聚类唯一ID
  cluster_id TEXT NOT NULL UNIQUE,
  -- 聚类业务键
  cluster_key TEXT,
  -- 聚类标题
  headline TEXT,
  -- 聚类摘要
  summary TEXT,
  -- taxonomy 键
  taxonomy_key TEXT,
  -- 重要性评分
  importance_score REAL NOT NULL DEFAULT 0,
  -- 主题发布时间
  published_at TEXT,
  -- 首次发现时间
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 最近发现时间
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 聚合资讯数
  item_count INTEGER NOT NULL DEFAULT 0,
  -- 状态
  status TEXT NOT NULL DEFAULT 'active',
  -- 扩展元数据JSON
  meta_json TEXT,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 更新时间
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引：按 taxonomy 和最近发现时间查询聚类
CREATE INDEX IF NOT EXISTS idx_news_clusters_taxonomy
  ON news_clusters (taxonomy_key, last_seen_at DESC, id DESC);

-- 索引：按重要性和最近发现时间查询聚类
CREATE INDEX IF NOT EXISTS idx_news_clusters_importance
  ON news_clusters (importance_score DESC, last_seen_at DESC, id DESC);

-- 表：news_cluster_items
-- 说明：聚类和资讯的关联表
CREATE TABLE IF NOT EXISTS news_cluster_items (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 聚类唯一ID
  cluster_id TEXT NOT NULL,
  -- 资讯唯一ID
  news_uid TEXT NOT NULL,
  -- 权重
  weight REAL NOT NULL DEFAULT 1,
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cluster_id, news_uid)
);

-- 索引：按资讯ID查询所属聚类
CREATE INDEX IF NOT EXISTS idx_news_cluster_items_news
  ON news_cluster_items (news_uid, id DESC);

-- 表：news_ai_digests
-- 说明：AI 生成的资讯摘要和专题结论
CREATE TABLE IF NOT EXISTS news_ai_digests (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 摘要唯一ID
  digest_id TEXT NOT NULL UNIQUE,
  -- 摘要类型
  digest_type TEXT NOT NULL,
  -- 作用域类型
  scope_type TEXT NOT NULL,
  -- 作用域键
  scope_key TEXT,
  -- 标题
  title TEXT NOT NULL,
  -- 摘要正文
  summary TEXT,
  -- 亮点JSON
  highlights_json TEXT,
  -- 风险JSON
  risks_json TEXT,
  -- 关联实体JSON
  related_entities_json TEXT,
  -- 使用模型
  model TEXT,
  -- 提示词版本
  prompt_version TEXT,
  -- 来源聚类ID列表JSON
  source_cluster_ids_json TEXT,
  -- 来源资讯UID列表JSON
  source_news_uids_json TEXT,
  -- 生成时间
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引：按摘要类型、作用域和生成时间查询AI摘要
CREATE INDEX IF NOT EXISTS idx_news_ai_digests_lookup
  ON news_ai_digests (digest_type, scope_type, scope_key, generated_at DESC, id DESC);

-- =====================================
-- 模块：本地股票日线缓存
-- =====================================

-- 表：stock_daily_bars
-- 说明：A股股票日线本地缓存表，优先服务蓝筹模式和批量历史分析
CREATE TABLE IF NOT EXISTS stock_daily_bars (
  -- 主键ID
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 股票代码
  stock_code TEXT NOT NULL,
  -- Tushare风格代码，例如 600519.SH
  ts_code TEXT NOT NULL,
  -- 交易日期
  trade_date TEXT NOT NULL,
  -- 开盘价
  open REAL,
  -- 最高价
  high REAL,
  -- 最低价
  low REAL,
  -- 收盘价
  close REAL,
  -- 前收盘价
  pre_close REAL,
  -- 涨跌额
  change REAL,
  -- 涨跌幅
  pct_chg REAL,
  -- 成交量
  vol REAL,
  -- 成交额
  amount REAL,
  -- 数据来源
  source TEXT NOT NULL DEFAULT 'tushare.daily',
  -- 最近同步时间
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 创建时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 更新时间
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (stock_code, trade_date)
);

-- 索引：按股票代码和交易日期倒序查询本地日线
CREATE INDEX IF NOT EXISTS idx_stock_daily_bars_code_date
  ON stock_daily_bars (stock_code, trade_date DESC);

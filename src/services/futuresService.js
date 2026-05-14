/**
 * 期货服务模块 (futuresService)
 *
 * 本模块提供期货相关的核心业务逻辑，包括：
 * - 期货品种搜索与解析
 * - 实时行情获取
 * - K线数据获取与本地缓存管理
 * - 期货监测看板数据聚合
 * - 分类与品种管理
 *
 * 数据来源：
 * - 东方财富网 (eastmoney) - 主要数据源
 * - 腾讯财经 - 补充数据源
 *
 * @module futuresService
 */

import { HttpError } from '../utils/httpError.js';
import { futuresRepository } from '../repositories/futuresRepository.js';
import { futuresBasicsRepository } from '../repositories/futuresBasicsRepository.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { nowLocalDateTime, toLocalDateTime } from '../utils/date.js';
import { getOfficialFuturesTradingHours } from '../utils/tradingHours.js';

// ============ API 认证与配置常量 ============

/** 东方财富期货行情接口 Token */
const FUTURES_QUOTE_TOKEN = '1101ffec61617c99be287c1bec3085ff';

/** 东方财富历史K线接口 UT 参数 */
const FUTURES_HISTORY_UT = 'fa5fd1943c7b386f172d6893dbfba10b';

/** 预设品种缓存有效期 (6小时) */
const FUTURES_PRESET_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** execFile 的 Promise 化版本，用于调用 curl 命令 */
const execFileAsync = promisify(execFile);

// ============ 时间粒度配置 ============

/**
 * 时间粒度映射表
 * key: 时间粒度代码（用于API请求和前端显示）
 * value.code: 东方财富API对应的代码（null表示不支持API请求）
 * value.label: 中文显示标签
 */
const FUTURES_TIMEFRAME_MAP = {
  '30s': { code: null, label: '30秒' },
  '1m': { code: '1', label: '1分钟' },
  '5m': { code: '5', label: '5分钟' },
  '15m': { code: '15', label: '15分钟' },
  '30m': { code: '30', label: '30分钟' },
  '60m': { code: '60', label: '60分钟' },
  '1d': { code: '101', label: '日线' },
  '1w': { code: '102', label: '周线' },
  '1M': { code: '103', label: '月线' },
};

/** 长周期K线类型集合（日线、周线、月线），这些类型的K线优先使用本地缓存 */
const FUTURES_LONG_KLINE_KEYS = new Set(['1d', '1w', '1M']);

/**
 * 盘中时间粒度对应的分钟数
 * 用于计算K线时间间隔和填充缺口
 */
const FUTURES_INTRADAY_INTERVAL_MINUTES = {
  '30s': 0.5,
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '60m': 60,
};

/**
 * 存储的时间粒度对应的分钟数（包含长周期）
 * 用于本地K线数据存储时的时间对齐
 */
const FUTURES_STORED_TIMEFRAME_INTERVAL_MINUTES = {
  ...FUTURES_INTRADAY_INTERVAL_MINUTES,
  '1d': 1440,
  '1w': 10080,
  '1M': 43200,
};

/**
 * 监测看板默认K线数量映射
 * 1分钟粒度默认请求1800条（约30小时数据）
 */
const FUTURES_MONITOR_DEFAULT_LIMIT_MAP = {
  '1m': 1800,
};

/** 本地盘中K线存储的最大条数限制 */
const FUTURES_INTRADAY_STORE_MAX_LIMIT = 4000;

/** 本地SQLite盘中K线数据源标识 */
const LOCAL_INTRADAY_DATA_SOURCE = 'local.sqlite.intraday';

/** 从1分钟K线推导出的数据源标识（用于长周期K线） */
const LOCAL_DERIVED_INTRADAY_SOURCE = 'local.derived.from.1m';

/** 长周期K线后台同步的最小间隔时间 (60秒)，避免频繁触发 */
const LONG_KLINE_BACKGROUND_SYNC_MIN_INTERVAL_MS = 60 * 1000;

/** 长周期K线后台同步状态缓存，记录每个品种+时间粒度的同步状态 */
const longKlineBackgroundSyncState = new Map();

// ============ 品种代码别名映射 ============

/**
 * 品种代码别名映射表
 * 将常用简写映射到标准品种代码
 * 例如：GC -> 101.GC00Y（黄金主连）
 */
const FUTURES_ALIAS_CODE_MAP = {
  GC: '101.GC00Y',
  SI: '101.SI00Y',
  HG: '101.HG00Y',
  CL: '102.CL00Y',
  NG: '102.NG00Y',
  RB: '102.RB00Y',
  HO: '102.HO00Y',
  B: '112.B00Y',
  GOLD: '101.GC00Y',
  SILVER: '101.SI00Y',
};

/**
 * 品种中文名称映射表
 * 将中文别名映射到标准品种代码
 * 例如：黄金 -> 101.GC00Y
 */
const FUTURES_ALIAS_NAME_MAP = {
  黄金: '101.GC00Y',
  白银: '101.SI00Y',
  铜: '101.HG00Y',
  原油: '102.CL00Y',
  布伦特原油: '112.B00Y',
  天然气: '102.NG00Y',
};

/**
 * 腾讯财经期货代码映射表
 * 将标准品种代码映射到腾讯财经API使用的代码
 * 例如：101.GC00Y -> hf_GC
 */
const FUTURES_TENCENT_QUOTE_MAP = {
  '101.GC00Y': 'hf_GC',
  '101.SI00Y': 'hf_SI',
  '101.HG00Y': 'hf_HG',
  '102.CL00Y': 'hf_CL',
  '102.NG00Y': 'hf_NG',
  '112.B00Y': 'hf_OIL',
};

/**
 * 期货预设品种备选列表
 * 当远程获取失败时，使用此列表作为默认品种
 * 包含主要国际期货品种和国内期货示例
 */
const FUTURES_PRESET_FALLBACK = [
  { exchange: 'COMEX', name: '黄金主连', quoteCode: '101.GC00Y', source: 'local.fallback' },
  { exchange: 'COMEX', name: '白银主连', quoteCode: '101.SI00Y', source: 'local.fallback' },
  { exchange: 'COMEX', name: '铜主连', quoteCode: '101.HG00Y', source: 'local.fallback' },
  { exchange: 'NYMEX', name: '原油主连', quoteCode: '102.CL00Y', source: 'local.fallback' },
  { exchange: 'NYMEX', name: '天然气主连', quoteCode: '102.NG00Y', source: 'local.fallback' },
  { exchange: 'IPE', name: '布伦特原油主连', quoteCode: '112.B00Y', source: 'local.fallback' },
  { exchange: '上期所(示例)', name: '沪金(自动匹配当前合约)', quoteCode: 'au', source: 'local.fallback' },
  { exchange: '上期所(示例)', name: '沪银(自动匹配当前合约)', quoteCode: 'ag', source: 'local.fallback' },
  { exchange: '上期能源(示例)', name: '原油(自动匹配当前合约)', quoteCode: 'sc', source: 'local.fallback' },
];

/**
 * 期货预设品种缓存对象
 * 存储从远程获取的预设品种列表，避免频繁请求
 * updatedAt: 最后更新时间戳
 * items: 品种列表
 */
const futuresPresetCache = {
  updatedAt: 0,
  items: [],
};

// ============ 基础工具函数 ============

/**
 * 将值转换为数字，无效值返回 null
 * @param {*} value - 待转换的值
 * @returns {number|null} - 转换后的数字或 null
 */
function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 将值转换为布尔值
 * @param {*} value - 待转换的值
 * @param {boolean} [fallback=true] - 当值为空时的默认返回值
 * @returns {boolean} - 转换后的布尔值
 */
function toBool(value, fallback = true) {
  // 空值使用默认值
  if (value === undefined || value === null || value === '') return fallback;
  // 布尔值直接返回
  if (typeof value === 'boolean') return value;
  // 数字类型：非零为 true
  if (typeof value === 'number') return value !== 0;
  // 字符串类型：解析常见布尔值字符串
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
}

/**
 * 解码 GBK 编码的数据
 * 用于处理部分中文数据源的编码问题
 * @param {Buffer|Array} buffer - GBK 编码的数据
 * @returns {string} - 解码后的字符串
 */
function decodeGbkPayload(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  try {
    return new TextDecoder('gbk').decode(source);
  } catch {
    // GBK 解码失败时，回退到 UTF-8
    return source.toString('utf8');
  }
}

// ============ 错误处理与日志工具函数 ============

/**
 * 检查错误是否已被记录过（避免重复日志）
 * @param {Error} error - 错误对象
 * @returns {boolean} - 是否已记录过
 */
function wasMonitorErrorLogged(error) {
  return Boolean(error && typeof error === 'object' && error.__monitorLogged === true);
}

/**
 * 标记错误已被记录（防止重复日志）
 * @param {Error} error - 错误对象
 */
function markMonitorErrorLogged(error) {
  if (!error || typeof error !== 'object') return;
  try {
    // 使用 defineProperty 设置不可枚举的标记属性
    Object.defineProperty(error, '__monitorLogged', {
      value: true,
      configurable: true,
      enumerable: false,
      writable: true,
    });
  } catch {
    // defineProperty 失败时，直接赋值
    // eslint-disable-next-line no-param-reassign
    error.__monitorLogged = true;
  }
}

/**
 * 记录期货监测过程中的问题日志
 * 统一格式化输出错误信息，便于调试和排查
 * @param {Object} options - 日志选项
 * @param {string} [options.level='error'] - 日志级别 ('error' 或 'warn')
 * @param {string} [options.stage='unknown'] - 问题发生阶段
 * @param {Object} [options.symbol=null] - 相关品种信息
 * @param {string} [options.timeframe=''] - 时间粒度
 * @param {number} [options.limit=null] - K线数量限制
 * @param {Error} [options.error=null] - 错误对象
 * @param {Object} [options.extra=null] - 附加信息
 */
function logFuturesMonitorIssue({
  level = 'error',
  stage = 'unknown',
  symbol = null,
  timeframe = '',
  limit = null,
  error = null,
  extra = null,
} = {}) {
  // 避免重复记录同一错误
  if (wasMonitorErrorLogged(error)) return;

  // 根据级别选择日志方法
  const logger = level === 'warn' ? console.warn : console.error;
  // 构建错误原因文本
  const causeText = buildErrorCauseText(error);
  // 提取调试信息
  const errorDebug = (
    error && typeof error === 'object' && Object.prototype.hasOwnProperty.call(error, '__debug')
      ? error.__debug
      : undefined
  );
  const remoteUrl = String(errorDebug?.url || extra?.url || '');

  // 输出结构化日志
  logger('[futures-monitor]', {
    at: nowLocalDateTime(),
    level,
    stage,
    quoteCode: symbol?.quoteCode || null,
    staticCode: symbol?.staticCode || null,
    secid: symbol?.secid || null,
    timeframe: timeframe || null,
    limit: Number.isFinite(Number(limit)) ? Number(limit) : null,
    errorName: error?.name || null,
    errorCode: error?.code || null,
    errorStatus: error?.status || null,
    errorMessage: error?.message || (error ? String(error) : null),
    errorCause: causeText || null,
    errorDebug: errorDebug || undefined,
    remoteUrl: remoteUrl || undefined,
    extra: extra || undefined,
  });

  // 错误级别或包含 failed/error 关键字的阶段，输出堆栈信息
  const shouldPrintTrace = Boolean(
    error?.stack
    && (level === 'error' || /failed|error/i.test(String(stage || ''))),
  );
  if (shouldPrintTrace) {
    logger('[futures-monitor][trace]', error.stack);
  }

  // 标记错误已记录
  markMonitorErrorLogged(error);
}

/**
 * 为错误对象附加调试元信息
 * @param {Error} error - 错误对象
 * @param {Object} options - 附加信息选项
 * @param {Error} [options.cause=null] - 根因错误
 * @param {Object} [options.debug=null] - 调试信息
 * @returns {Error} - 附加信息后的错误对象
 */
function attachDebugErrorMeta(error, { cause = null, debug = null } = {}) {
  if (!error || typeof error !== 'object') return error;

  // 附加根因错误
  if (cause && typeof cause === 'object') {
    try {
      Object.defineProperty(error, 'cause', {
        value: cause,
        configurable: true,
        enumerable: false,
        writable: true,
      });
    } catch {
      // eslint-disable-next-line no-param-reassign
      error.cause = cause;
    }
  }

  // 附加调试信息
  if (debug !== undefined && debug !== null) {
    try {
      Object.defineProperty(error, '__debug', {
        value: debug,
        configurable: true,
        enumerable: false,
        writable: true,
      });
    } catch {
      // eslint-disable-next-line no-param-reassign
      error.__debug = debug;
    }
  }

  return error;
}

/**
 * 压缩文本，去除多余空白字符
 * @param {string} [value=''] - 待压缩的文本
 * @returns {string} - 压缩后的文本
 */
function compactText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 构建错误原因链文本
 * 遍历 error.cause 链，提取各级错误的关键信息
 * @param {Error} error - 错误对象
 * @param {number} [maxDepth=4] - 最大遍历深度
 * @returns {string} - 格式化的原因链文本
 */
function buildErrorCauseText(error, maxDepth = 4) {
  const parts = [];
  const seen = new Set(); // 防止循环引用
  let current = error;
  let depth = 0;

  // 遍历错误链，提取各级关键信息
  while (current && typeof current === 'object' && depth < maxDepth && !seen.has(current)) {
    seen.add(current);
    const item = [];
    // 提取常见错误属性
    if (current.name) item.push(`name=${compactText(current.name)}`);
    if (current.code) item.push(`code=${compactText(current.code)}`);
    if (current.errno !== undefined && current.errno !== null) item.push(`errno=${current.errno}`);
    if (current.syscall) item.push(`syscall=${compactText(current.syscall)}`);
    if (current.hostname) item.push(`hostname=${compactText(current.hostname)}`);
    if (current.address) item.push(`address=${compactText(current.address)}`);
    if (current.port !== undefined && current.port !== null) item.push(`port=${current.port}`);
    if (current.message) item.push(`message=${compactText(current.message)}`);
    if (item.length) {
      parts.push(`[${depth}] ${item.join(', ')}`);
    }
    current = current.cause;
    depth += 1;
  }

  return compactText(parts.join(' <= '));
}

/**
 * 提取错误信息的简短摘要
 * 优先使用 stderr，然后是 message，最后是默认文本
 * @param {Error} error - 错误对象
 * @param {string} [fallback='未知错误'] - 默认文本
 * @returns {string} - 简短错误信息
 */
function briefErrorMessage(error, fallback = '未知错误') {
  const stderr = String(error?.stderr || '').trim();
  const message = String(error?.message || '').trim();
  const source = stderr || message || fallback;
  // 取最后一行（通常是最关键的错误信息）
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] || fallback;
}

// ============ 行情涨跌计算函数 ============

/**
 * 标准化行情涨跌指标
 * 根据价格、昨收、涨跌额、涨跌幅计算完整的涨跌信息
 * 支持多种输入组合，自动推导缺失的值
 * @param {Object} params - 计算参数
 * @param {number} [params.price] - 当前价格
 * @param {number} [params.prevClose] - 昨日收盘价
 * @param {number} [params.change] - 涨跌额
 * @param {number} [params.changePct] - 涨跌幅（百分比）
 * @returns {Object} - 包含 change 和 changePct 的对象
 */
function normalizeQuoteChangeMetrics({ price, prevClose, change, changePct }) {
  let normalizedChange = toNum(change);
  let normalizedPct = toNum(changePct);
  const normalizedPrice = toNum(price);
  const normalizedPrevClose = toNum(prevClose);

  // 根据价格和涨跌额推导昨收价
  const derivedPrevClose = (
    normalizedPrice != null
    && normalizedChange != null
  ) ? (normalizedPrice - normalizedChange) : null;

  // 如果涨跌额缺失，根据价格和昨收价计算
  if (
    normalizedChange == null
    && normalizedPrice != null
    && normalizedPrevClose != null
    && normalizedPrevClose !== 0
  ) {
    normalizedChange = normalizedPrice - normalizedPrevClose;
  }

  // 如果涨跌额缺失，根据涨跌幅和昨收价计算
  if (
    normalizedChange == null
    && normalizedPct != null
    && normalizedPrevClose != null
    && normalizedPrevClose !== 0
  ) {
    normalizedChange = normalizedPrevClose * (normalizedPct / 100);
  }

  // 根据涨跌额和推导的昨收价计算涨跌幅
  if (
    normalizedChange != null
    && derivedPrevClose != null
    && derivedPrevClose !== 0
  ) {
    normalizedPct = (normalizedChange / derivedPrevClose) * 100;
  } else
  // 根据涨跌额和昨收价计算涨跌幅
  if (
    normalizedChange != null
    && normalizedPrevClose != null
    && normalizedPrevClose !== 0
  ) {
    normalizedPct = (normalizedChange / normalizedPrevClose) * 100;
  }

  // 确保涨跌幅符号与涨跌额一致
  if (normalizedChange != null && normalizedPct != null && normalizedChange !== 0 && normalizedPct !== 0) {
    const sign = normalizedChange > 0 ? 1 : -1;
    normalizedPct = Math.abs(normalizedPct) * sign;
  }

  return {
    change: normalizedChange,
    changePct: normalizedPct,
  };
}

// ============ 品种代码转换函数 ============

/**
 * 将品种信息转换为腾讯财经使用的期货代码
 * @param {Object} symbol - 品种信息对象
 * @returns {string} - 腾讯财经代码，如 'hf_GC'
 */
function toTencentFuturesCode(symbol = {}) {
  const quoteCode = String(symbol?.quoteCode || '').trim().toUpperCase();
  return FUTURES_TENCENT_QUOTE_MAP[quoteCode] || '';
}

/**
 * 格式化腾讯财经返回的交易时间
 * 将日期和时间字段合并为标准格式
 * @param {string} dateValue - 日期字段，如 '2024-01-15'
 * @param {string} timeValue - 时间字段，如 '09:30:00'
 * @returns {string|null} - 格式化后的时间字符串，如 '2024-01-15 09:30:00'
 */
function formatTencentFuturesTradeTime(dateValue, timeValue) {
  const dateText = String(dateValue || '').trim();
  const timeText = String(timeValue || '').trim();
  if (!dateText && !timeText) return null;

  // 标准格式直接拼接
  if (/^\d{2}:\d{2}:\d{2}$/.test(timeText) && /^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    return `${dateText} ${timeText}`;
  }

  // 非标准格式使用本地时间转换
  return toLocalDateTime(`${dateText} ${timeText}`.trim(), null);
}

// ============ K线数据解析函数 ============

/**
 * 解析单行K线数据
 * 东方财富返回的K线数据为逗号分隔的文本格式
 * @param {string} line - K线数据行，格式: "日期,开盘,收盘,最高,最低,成交量,成交额"
 * @returns {Object|null} - 解析后的K线对象，无效数据返回 null
 */
function parseKlineRow(line) {
  const parts = String(line || '').split(',');
  // 至少需要6个字段：日期、开、收、高、低、量
  if (parts.length < 6) return null;

  const date = parts[0];
  const open = toNum(parts[1]);
  const close = toNum(parts[2]);
  const high = toNum(parts[3]);
  const low = toNum(parts[4]);
  const volume = toNum(parts[5]);
  const amount = toNum(parts[6]);

  // 必须有日期和收盘价
  if (!date || close == null) return null;

  return {
    date,
    open,
    high,
    low,
    close,
    volume: volume ?? 0,
    amount: amount ?? 0,
  };
}

/**
 * 将K线日期字符串转换为时间戳（秒）
 * 支持带时间和不带时间的格式
 * @param {string} dateText - 日期字符串，如 '2024-01-15' 或 '2024-01-15 09:30:00'
 * @returns {number|null} - Unix时间戳（秒），无效格式返回 null
 */
function parseCandleDateToTs(dateText) {
  const text = String(dateText || '').trim();
  if (!text) return null;

  // 匹配日期时间格式
  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!match) return null;

  // 解析各字段
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] || '0');
  const minute = Number(match[5] || '0');
  const second = Number(match[6] || '0');

  // 构建本地时间戳
  const tsMs = new Date(year, month - 1, day, hour, minute, second).getTime();
  if (!Number.isFinite(tsMs)) return null;
  return Math.floor(tsMs / 1000);
}

// ============ 时间计算函数 ============

/**
 * 格式化本地日期为 YYYY-MM-DD 格式
 * @param {Date} [date=new Date()] - 日期对象
 * @returns {string} - 格式化后的日期字符串
 */
function formatLocalDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 获取一天的开始时间（00:00:00）
 * @param {Date} [date=new Date()] - 日期对象
 * @returns {Date} - 当天开始的Date对象
 */
function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

/**
 * 获取ISO周的开始时间（周一 00:00:00）
 * ISO周从周一开始，而JS的getDay()周日为0
 * @param {Date} [date=new Date()] - 日期对象
 * @returns {Date} - 本周周一开始的Date对象
 */
function startOfIsoWeek(date = new Date()) {
  const dayStart = startOfDay(date);
  const weekday = dayStart.getDay(); // 0=周日, 1=周一, ...
  // 周日需要回退6天，其他日期回退 weekday-1 天
  const moveBack = weekday === 0 ? 6 : weekday - 1;
  return new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() - moveBack, 0, 0, 0, 0);
}

/**
 * 获取月份的开始时间（月初 00:00:00）
 * @param {Date} [date=new Date()] - 日期对象
 * @returns {Date} - 本月月初的Date对象
 */
function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

/**
 * 根据时间粒度获取当前周期的起始日期
 * 日线：当天开始；周线：本周周一；月线：本月月初
 * @param {string} [timeframe='1d'] - 时间粒度 ('1d', '1w', '1M')
 * @param {Date} [now=new Date()] - 当前时间
 * @returns {string} - 周期起始日期字符串 (YYYY-MM-DD)
 */
function currentPeriodStartDay(timeframe = '1d', now = new Date()) {
  const tf = String(timeframe || '');
  if (tf === '1w') return formatLocalDate(startOfIsoWeek(now));
  if (tf === '1M') return formatLocalDate(startOfMonth(now));
  return formatLocalDate(startOfDay(now));
}

/**
 * 根据日期文本和时间粒度计算周期键值
 * 用于判断K线数据是否属于当前周期
 * @param {string} dateText - 日期字符串
 * @param {string} [timeframe='1d'] - 时间粒度
 * @returns {string} - 周期键值（日线为日期，周线为周一日期，月线为年月）
 */
function periodKeyByDateText(dateText, timeframe = '1d') {
  const ts = parseCandleDateToTs(dateText);
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts * 1000);
  const tf = String(timeframe || '');

  // 周线：返回周一日期
  if (tf === '1w') {
    return formatLocalDate(startOfIsoWeek(d));
  }
  // 月线：返回年月格式
  if (tf === '1M') {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  // 日线：返回日期
  return formatLocalDate(startOfDay(d));
}

/**
 * 将时间戳按时间粒度对齐到周期起始时间戳
 * @param {number} rawTs - 原始时间戳（秒）
 * @param {string} [timeframe='1d'] - 时间粒度
 * @returns {number} - 对齐后的时间戳（秒）
 */
function periodBucketTs(rawTs, timeframe = '1d') {
  const d = new Date(rawTs * 1000);
  const tf = String(timeframe || '');
  if (tf === '1w') {
    return Math.floor(startOfIsoWeek(d).getTime() / 1000);
  }
  if (tf === '1M') {
    return Math.floor(startOfMonth(d).getTime() / 1000);
  }
  return Math.floor(startOfDay(d).getTime() / 1000);
}

/**
 * 将时间戳转换为日期字符串
 * 根据时间粒度决定是否包含时间部分
 * @param {number} ts - Unix时间戳（秒）
 * @param {number} intervalMinutes - 时间间隔分钟数
 * @returns {string} - 日期字符串（日线及以上不含时间，其他包含）
 */
function toDateString(ts, intervalMinutes) {
  const date = new Date(ts * 1000);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');

  // 日线及以上（>=1440分钟）只显示日期
  if (intervalMinutes >= 1440) {
    return `${y}-${m}-${d}`;
  }
  // 盘中时间粒度显示完整日期时间
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

// ============ K线数据处理与存储函数 ============

/**
 * 填充盘中K线数据的时间缺口
 * 在非交易时段或数据缺失时，用前一根K线收盘价填充缺口
 * 确保K线序列连续，便于技术指标计算和图表展示
 * @param {Array} [candles=[]] - K线数据数组
 * @param {string} [timeframe='1m'] - 时间粒度
 * @param {Object} [options={}] - 配置选项
 * @param {boolean} [options.latestDayOnly=false] - 是否只填充最新一天的数据
 * @returns {Array} - 填充后的K线数据数组
 */
function fillIntradayCandleGaps(candles = [], timeframe = '1m', { latestDayOnly = false } = {}) {
  // 获取时间间隔分钟数
  const intervalMinutes = FUTURES_INTRADAY_INTERVAL_MINUTES[timeframe];
  if (!intervalMinutes || !Array.isArray(candles) || !candles.length) {
    return Array.isArray(candles) ? candles : [];
  }

  // 时间桶跨度（秒）
  const bucketSpan = intervalMinutes * 60;

  // 解析并排序K线数据
  const parsed = candles
    .map((item, index) => {
      const ts = parseCandleDateToTs(item?.date);
      if (!Number.isFinite(ts)) return null;
      return { ...item, _ts: ts, _index: index };
    })
    .filter(Boolean)
    .sort((a, b) => (a._ts - b._ts) || (a._index - b._index));

  if (!parsed.length) return Array.isArray(candles) ? candles : [];

  // 确定填充范围
  let scope = parsed;
  if (latestDayOnly) {
    // 只处理最新一天的数据
    const latestDay = String(parsed[parsed.length - 1]?.date || '').slice(0, 10);
    const latestDayItems = parsed.filter((item) => String(item?.date || '').slice(0, 10) === latestDay);
    if (latestDayItems.length) {
      scope = latestDayItems;
    }
  }
  if (!scope.length) return [];

  // 将K线对齐到时间桶，去重
  const alignedMap = new Map();
  scope.forEach((item) => {
    const alignedTs = Math.floor(item._ts / bucketSpan) * bucketSpan;
    alignedMap.set(alignedTs, {
      ...item,
      _ts: alignedTs,
      date: toDateString(alignedTs, intervalMinutes),
    });
  });
  const rows = Array.from(alignedMap.values()).sort((a, b) => a._ts - b._ts);
  if (!rows.length) return [];

  // 从第一根K线开始，逐个时间桶填充
  const first = rows[0];
  const last = rows[rows.length - 1];
  const byTs = new Map(rows.map((item) => [item._ts, item]));
  const continuous = [];

  // 初始化前收盘价
  let prevClose = toNum(first.close);
  if (prevClose == null) prevClose = toNum(first.open);
  if (prevClose == null) prevClose = 0;

  // 遍历所有时间桶
  for (let ts = first._ts; ts <= last._ts; ts += bucketSpan) {
    const hit = byTs.get(ts);
    if (hit) {
      // 有数据的桶，直接使用
      continuous.push(hit);
      const close = toNum(hit.close);
      if (close != null) {
        prevClose = close;
      }
      continue;
    }

    // 缺失的桶，用前收盘价填充（模拟无交易时段）
    continuous.push({
      date: toDateString(ts, intervalMinutes),
      open: prevClose,
      high: prevClose,
      low: prevClose,
      close: prevClose,
      volume: 0,
      amount: 0,
      _ts: ts,
    });
  }

  // 返回清理后的数据（移除内部属性）
  return continuous.map((item) => ({
    date: item.date,
    open: toNum(item.open),
    high: toNum(item.high),
    low: toNum(item.low),
    close: toNum(item.close),
    volume: toNum(item.volume) ?? 0,
    amount: toNum(item.amount) ?? 0,
  }));
}

/**
 * 标准化盘中K线数量限制
 * 确保限制值在合理范围内（20 ~ 最大存储限制）
 * @param {number} limit - 原始限制值
 * @param {string} [timeframe='1m'] - 时间粒度
 * @returns {number} - 标准化后的限制值
 */
function normalizeIntradayLimit(limit, timeframe = '1m') {
  const base = FUTURES_MONITOR_DEFAULT_LIMIT_MAP[timeframe] || 120;
  return Math.min(Math.max(Number(limit) || base, 20), FUTURES_INTRADAY_STORE_MAX_LIMIT);
}

/**
 * 对齐单根K线数据到时间桶
 * 将K线时间对齐到指定时间粒度的时间边界
 * @param {Object} item - K线数据对象
 * @param {string} [timeframe='1m'] - 时间粒度
 * @param {number} [index=0] - 序号（用于排序）
 * @returns {Object|null} - 对齐后的K线对象，无效数据返回 null
 */
function alignIntradayCandle(item, timeframe = '1m', index = 0) {
  const tf = String(timeframe || '');
  const intervalMinutes = FUTURES_STORED_TIMEFRAME_INTERVAL_MINUTES[tf];
  if (!intervalMinutes) return null;

  // 解析时间戳
  const rawTs = parseCandleDateToTs(item?.date);
  if (!Number.isFinite(rawTs)) return null;

  // 计算时间桶跨度和对齐后的时间戳
  const bucketSpan = Math.max(1, Math.round(intervalMinutes * 60));
  const bucketTs = FUTURES_LONG_KLINE_KEYS.has(tf)
    ? periodBucketTs(rawTs, tf)
    : Math.floor(rawTs / bucketSpan) * bucketSpan;
  const longDateText = String(item?.date || '').trim().slice(0, 10);

  // 解析OHLCV数据
  const open = toNum(item?.open);
  const high = toNum(item?.high);
  const low = toNum(item?.low);
  const close = toNum(item?.close);
  // 必须有至少一个价格数据
  if (close == null && open == null && high == null && low == null) return null;

  return {
    _index: index,
    _ts: bucketTs,
    // 长周期K线保留原始日期格式，盘中K线使用对齐后的格式
    date: FUTURES_LONG_KLINE_KEYS.has(tf)
      ? (longDateText || toDateString(rawTs, intervalMinutes))
      : toDateString(bucketTs, intervalMinutes),
    open,
    high,
    low,
    close,
    volume: toNum(item?.volume) ?? 0,
    amount: toNum(item?.amount) ?? 0,
  };
}

/**
 * 将K线数组转换为适合存储的数据格式
 * 用于持久化到SQLite数据库
 * @param {Array} [candles=[]] - K线数据数组
 * @param {string} [timeframe='1m'] - 时间粒度
 * @param {string} [source=null] - 数据来源标识
 * @returns {Array} - 存储格式的数据数组
 */
function candlesToIntradayStoreBars(candles = [], timeframe = '1m', source = null) {
  if (!Array.isArray(candles) || !candles.length) return [];

  // 对齐并排序K线数据
  const aligned = candles
    .map((item, index) => alignIntradayCandle(item, timeframe, index))
    .filter(Boolean)
    .sort((a, b) => (a._ts - b._ts) || (a._index - b._index));
  if (!aligned.length) return [];

  // 按时间戳去重（保留最新的）
  const deduped = new Map();
  aligned.forEach((item) => {
    deduped.set(item._ts, item);
  });

  // 转换为存储格式
  return Array.from(deduped.values())
    .sort((a, b) => a._ts - b._ts)
    .map((item) => ({
      tradeDay: String(item.date || '').slice(0, 10), // 交易日期
      bucketTs: item._ts, // 时间戳
      date: item.date, // 日期时间字符串
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume ?? 0,
      amount: item.amount ?? 0,
      source: source || null, // 数据来源
    }));
}

/**
 * 将数据库存储的K线数据转换为标准K线格式
 * @param {Array} [rows=[]] - 数据库存储的数据数组
 * @returns {Array} - 标准K线数据数组
 */
function intradayBarsToCandles(rows = []) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.map((item) => ({
    date: item.date,
    open: toNum(item.open),
    high: toNum(item.high),
    low: toNum(item.low),
    close: toNum(item.close),
    volume: toNum(item.volume) ?? 0,
    amount: toNum(item.amount) ?? 0,
  }));
}

/**
 * 合并两组K线数据
 * 用于将新获取的数据与本地缓存数据合并
 * 相同时间戳的数据优先使用新数据
 * @param {Array} [baseCandles=[]] - 基础K线数据（通常是缓存数据）
 * @param {Array} [incomingCandles=[]] - 新获取的K线数据
 * @param {string} [timeframe='1m'] - 时间粒度
 * @returns {Array} - 合并后的K线数据数组
 */
function mergeIntradayCandles(baseCandles = [], incomingCandles = [], timeframe = '1m') {
  const base = Array.isArray(baseCandles) ? baseCandles : [];
  const incoming = Array.isArray(incomingCandles) ? incomingCandles : [];
  if (!base.length) return incoming;
  if (!incoming.length) return base;

  // 使用时间戳作为键，合并两组数据
  const merged = new Map();
  base.forEach((item, index) => {
    const aligned = alignIntradayCandle(item, timeframe, index);
    if (!aligned) return;
    merged.set(aligned._ts, aligned);
  });
  // 新数据覆盖旧数据（相同时间戳）
  incoming.forEach((item, index) => {
    const aligned = alignIntradayCandle(item, timeframe, index + 1000000);
    if (!aligned) return;
    merged.set(aligned._ts, aligned);
  });

  // 按时间戳排序并清理内部属性
  return Array.from(merged.values())
    .sort((a, b) => a._ts - b._ts)
    .map((item) => ({
      date: item.date,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume ?? 0,
      amount: item.amount ?? 0,
    }));
}

/**
 * 从K线数据中提取最新交易日期
 * @param {Array} [candles=[]] - K线数据数组
 * @returns {string|null} - 最新交易日期 (YYYY-MM-DD)，无数据返回 null
 */
function latestTradeDayFromCandles(candles = []) {
  if (!Array.isArray(candles) || !candles.length) return null;
  const latest = String(candles[candles.length - 1]?.date || '').slice(0, 10);
  return latest || null;
}

/**
 * 从本地数据库加载盘中K线数据
 * @param {Object} options - 加载选项
 * @param {string} options.quoteCode - 品种代码
 * @param {string} [options.timeframe='1m'] - 时间粒度
 * @param {string} [options.tradeDay] - 交易日期（可选，默认取最新）
 * @param {number} [options.limit=1800] - K线数量限制
 * @returns {Array} - K线数据数组
 */
function loadIntradayCandlesFromStore({ quoteCode, timeframe = '1m', tradeDay, limit = 1800 } = {}) {
  // 获取最新交易日期
  const day = tradeDay || futuresRepository.getLatestIntradayTradeDay({ quoteCode, timeframe });
  if (!day) return [];

  // 从数据库加载K线数据
  const rows = futuresRepository.listIntradayBars({
    quoteCode,
    timeframe,
    tradeDay: day,
    limit: normalizeIntradayLimit(limit, timeframe),
  });
  return intradayBarsToCandles(rows);
}

/**
 * 从本地数据库加载长周期K线数据（日线、周线、月线）
 * @param {Object} options - 加载选项
 * @param {string} options.quoteCode - 品种代码
 * @param {string} [options.timeframe='1d'] - 时间粒度
 * @param {number} [options.limit=120] - K线数量限制
 * @returns {Array} - K线数据数组
 */
function loadLongCandlesFromStore({ quoteCode, timeframe = '1d', limit = 120 } = {}) {
  const tf = String(timeframe || '');
  // 只处理长周期K线
  if (!FUTURES_LONG_KLINE_KEYS.has(tf)) return [];

  // 标准化限制值
  const normalizedLimit = Math.min(Math.max(Number(limit) || 120, 20), FUTURES_INTRADAY_STORE_MAX_LIMIT);

  // 从数据库加载
  const rows = futuresRepository.listIntradayBars({
    quoteCode,
    timeframe: tf,
    limit: normalizedLimit,
  });
  return intradayBarsToCandles(rows);
}

/**
 * 检查长周期K线缓存是否完整
 * 完整缓存应包含当前周期数据，且数量满足最低要求
 * @param {Array} [candles=[]] - K线数据数组
 * @param {string} [timeframe='1d'] - 时间粒度
 * @param {number} [limit=120] - 请求的K线数量
 * @returns {boolean} - 缓存是否完整
 */
function isLongCacheComplete(candles = [], timeframe = '1d', limit = 120) {
  const tf = String(timeframe || '');
  if (!FUTURES_LONG_KLINE_KEYS.has(tf)) return true;
  if (!Array.isArray(candles) || !candles.length) return false;

  // 检查是否包含当前周期的数据
  const currentKey = periodKeyByDateText(formatLocalDate(new Date()), tf);
  if (!currentKey) return false;
  const hasCurrentPeriod = candles.some((item) => periodKeyByDateText(item?.date, tf) === currentKey);
  if (!hasCurrentPeriod) return false;

  // 检查历史数据数量是否满足最低要求
  const normalizedLimit = Math.max(Number(limit) || 120, 20);
  const minHistoryByTf = tf === '1d' ? 20 : (tf === '1w' ? 12 : 6);
  const historyFloor = Math.min(minHistoryByTf, normalizedLimit);
  return candles.length >= historyFloor;
}

/**
 * 从1分钟K线数据构建当前长周期K线（日线、周线、月线）
 * 用于实时生成未完成的长周期K线
 * @param {Object} options - 构建选项
 * @param {string} options.quoteCode - 品种代码
 * @param {string} [options.timeframe='1d'] - 目标时间粒度
 * @param {Date} [options.now=new Date()] - 当前时间
 * @returns {Object|null} - 生成的K线对象，无数据返回 null
 */
function buildCurrentLongCandleFromMinuteStore({ quoteCode, timeframe = '1d', now = new Date() } = {}) {
  const tf = String(timeframe || '');
  if (!FUTURES_LONG_KLINE_KEYS.has(tf)) return null;

  // 计算周期范围
  const startDay = currentPeriodStartDay(tf, now);
  const endDay = formatLocalDate(now);

  // 从数据库加载该范围内的1分钟K线
  const minuteRows = futuresRepository.listIntradayBarsByRange({
    quoteCode,
    timeframe: '1m',
    startDay,
    endDay,
    limit: 50000,
  });
  if (!minuteRows.length) return null;

  // 计算周期键值
  const key = periodKeyByDateText(endDay, tf);

  // 筛选属于当前周期的数据
  const scoped = minuteRows
    .map((item) => ({
      date: item.date,
      open: toNum(item.open),
      high: toNum(item.high),
      low: toNum(item.low),
      close: toNum(item.close),
      volume: toNum(item.volume) ?? 0,
      amount: toNum(item.amount) ?? 0,
      ts: parseCandleDateToTs(item.date),
    }))
    .filter((item) => Number.isFinite(item.ts) && periodKeyByDateText(item.date, tf) === key)
    .sort((a, b) => a.ts - b.ts);
  if (!scoped.length) return null;

  // 找到第一根和最后一根有效的K线
  const first = scoped.find((item) => item.open != null || item.close != null);
  const last = [...scoped].reverse().find((item) => item.close != null || item.open != null);
  if (!first || !last) return null;

  // 确定开盘价和收盘价
  const open = first.open != null ? first.open : first.close;
  const close = last.close != null ? last.close : last.open;
  if (open == null || close == null) return null;

  // 计算最高价、最低价、成交量、成交额
  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  let volume = 0;
  let amount = 0;
  scoped.forEach((item) => {
    const candidateHigh = item.high != null ? item.high : item.close;
    const candidateLow = item.low != null ? item.low : item.close;
    if (candidateHigh != null) high = Math.max(high, candidateHigh);
    if (candidateLow != null) low = Math.min(low, candidateLow);
    volume += item.volume || 0;
    amount += item.amount || 0;
  });
  // 处理无效值
  if (!Number.isFinite(high)) high = Math.max(open, close);
  if (!Number.isFinite(low)) low = Math.min(open, close);

  return {
    // 使用当前日期便于图表展示未完成的周期
    date: endDay,
    open,
    high,
    low,
    close,
    volume,
    amount,
  };
}

// ============ K线后台同步与持久化函数 ============

/**
 * 触发长周期K线的后台同步任务
 * 当本地缓存不完整时，异步从远程获取数据并更新缓存
 * 使用状态缓存防止重复触发和并发执行
 * @param {Object} options - 同步选项
 * @param {Object} options.normalized - 标准化的品种信息
 * @param {string} [options.timeframe='1d'] - 时间粒度
 * @param {number} [options.limit=120] - K线数量限制
 */
function triggerLongKlineBackgroundSync({ normalized, timeframe = '1d', limit = 120 } = {}) {
  const tf = String(timeframe || '');
  // 只处理长周期K线
  if (!normalized?.quoteCode || !FUTURES_LONG_KLINE_KEYS.has(tf)) return;

  // 使用品种代码+时间粒度作为键，防止重复触发
  const key = `${normalized.quoteCode}|${tf}`;
  const now = Date.now();
  const state = longKlineBackgroundSyncState.get(key) || { running: false, lastAt: 0 };

  // 检查是否正在运行或刚执行过
  if (state.running) return;
  if (now - Number(state.lastAt || 0) < LONG_KLINE_BACKGROUND_SYNC_MIN_INTERVAL_MS) return;

  // 标记开始运行
  longKlineBackgroundSyncState.set(key, { running: true, lastAt: now });

  // 异步执行同步任务
  Promise.resolve()
    .then(async () => {
      // 从远程获取K线数据
      const candles = await fetchKline(normalized, { timeframe: tf, limit });
      // 持久化到本地数据库
      mergeAndPersistLongCandles({
        quoteCode: normalized.quoteCode,
        timeframe: tf,
        limit,
        candles,
        source: 'eastmoney.push2his',
      });

      // 从1分钟数据生成当前周期的K线
      const derived = buildCurrentLongCandleFromMinuteStore({
        quoteCode: normalized.quoteCode,
        timeframe: tf,
      });
      if (derived) {
        // 合并推导数据
        mergeAndPersistLongCandles({
          quoteCode: normalized.quoteCode,
          timeframe: tf,
          limit,
          candles: [derived],
          source: LOCAL_DERIVED_INTRADAY_SOURCE,
        });
      }
    })
    .catch(() => {}) // 静默处理错误，不影响主流程
    .finally(() => {
      // 标记任务完成
      longKlineBackgroundSyncState.set(key, { running: false, lastAt: Date.now() });
    });
}

/**
 * 合并并持久化盘中K线数据
 * 将新获取的K线数据与本地缓存合并后存储
 * 并填充时间缺口，返回完整的K线序列
 * @param {Object} options - 合并选项
 * @param {string} options.quoteCode - 品种代码
 * @param {string} [options.timeframe='1m'] - 时间粒度
 * @param {number} [options.limit=1800] - K线数量限制
 * @param {Array} [options.candles=[]] - 新获取的K线数据
 * @param {string} [options.source=null] - 数据来源标识
 * @returns {Array} - 合并后的K线数据数组
 */
function mergeAndPersistIntradayCandles({
  quoteCode,
  timeframe = '1m',
  limit = 1800,
  candles = [],
  source = null,
} = {}) {
  // 标准化限制值
  const normalizedLimit = normalizeIntradayLimit(limit, timeframe);

  // 将K线转换为存储格式并写入数据库
  const storeBars = candlesToIntradayStoreBars(candles, timeframe, source);
  if (storeBars.length) {
    futuresRepository.upsertIntradayBars({
      quoteCode,
      timeframe,
      bars: storeBars,
    });
  }

  // 获取交易日期
  const tradeDay = storeBars[storeBars.length - 1]?.tradeDay || latestTradeDayFromCandles(candles);

  // 从数据库加载已存储的数据
  const storedCandles = loadIntradayCandlesFromStore({
    quoteCode,
    timeframe,
    tradeDay,
    limit: normalizedLimit,
  });

  // 合并新旧数据
  const merged = mergeIntradayCandles(storedCandles, candles, timeframe);

  // 填充时间缺口（仅最新一天）
  const filled = fillIntradayCandleGaps(merged, timeframe, { latestDayOnly: true });

  // 返回限制数量的数据
  return filled.slice(-normalizedLimit);
}

/**
 * 合并并持久化长周期K线数据（日线、周线、月线）
 * @param {Object} options - 合并选项
 * @param {string} options.quoteCode - 品种代码
 * @param {string} [options.timeframe='1d'] - 时间粒度
 * @param {number} [options.limit=120] - K线数量限制
 * @param {Array} [options.candles=[]] - 新获取的K线数据
 * @param {string} [options.source=null] - 数据来源标识
 * @returns {Array} - 合并后的K线数据数组
 */
function mergeAndPersistLongCandles({
  quoteCode,
  timeframe = '1d',
  limit = 120,
  candles = [],
  source = null,
} = {}) {
  const tf = String(timeframe || '');
  // 只处理长周期K线
  if (!FUTURES_LONG_KLINE_KEYS.has(tf)) return Array.isArray(candles) ? candles : [];

  // 标准化限制值
  const normalizedLimit = Math.min(Math.max(Number(limit) || 120, 20), FUTURES_INTRADAY_STORE_MAX_LIMIT);

  // 将K线转换为存储格式并写入数据库
  const storeBars = candlesToIntradayStoreBars(candles, tf, source);
  if (storeBars.length) {
    futuresRepository.upsertIntradayBars({
      quoteCode,
      timeframe: tf,
      bars: storeBars,
    });
  }

  // 从数据库加载已存储的数据
  const storedCandles = loadLongCandlesFromStore({
    quoteCode,
    timeframe: tf,
    limit: normalizedLimit,
  });

  // 合并新旧数据
  const merged = mergeIntradayCandles(storedCandles, candles, tf);

  return merged.slice(-normalizedLimit);
}

// ============ 品种代码标准化函数 ============

/**
 * 标准化品种代码输入
 * 支持多种输入格式：带分隔符的格式(101.GC00Y)和无分隔符格式(101GC00Y)
 * 返回标准化的品种信息对象
 * @param {string} input - 原始品种代码输入
 * @returns {Object} - 标准化的品种信息对象
 * @throws {HttpError} - 无法识别的品种代码格式时抛出400错误
 */
function normalizeQuoteCode(input) {
  const text = String(input || '')
    .trim()
    .replace(/\s+/g, '');

  if (!text) {
    throw new HttpError(400, '品种代码不能为空');
  }

  // 尝试匹配带分隔符的格式：101.GC00Y 或 101_GC00Y 或 101-GC00Y
  const dotMatch = text.match(/^(\d{2,3})[._-]([A-Za-z0-9]+)$/);
  if (dotMatch) {
    const market = Number(dotMatch[1]);
    const code = dotMatch[2];
    return {
      market, // 市场代码
      code, // 合约代码
      secid: `${market}.${code}`, // 证券ID格式
      quoteCode: `${market}.${code}`, // 标准品种代码
      staticCode: `${market}_${code}`, // 静态代码格式（用于某些API）
    };
  }

  // 尝试匹配无分隔符的格式：101GC00Y
  const raw = text.replace(/[._-]/g, '');
  if (/^\d{2,3}[A-Za-z0-9]+$/.test(raw)) {
    const market = Number(raw.slice(0, 3));
    const code = raw.slice(3);
    if (Number.isFinite(market) && code) {
      return {
        market,
        code,
        secid: `${market}.${code}`,
        quoteCode: `${market}.${code}`,
        staticCode: `${market}_${code}`,
      };
    }
  }

  throw new HttpError(400, `无法识别品种代码: ${input}。请使用标准代码，如 101.GC00Y`);
}

// ============ 品种搜索与解析函数 ============

/**
 * 判断搜索结果项是否为期货品种
 * 根据多个字段判断，包括类型名称、分类、交易所等
 * @param {Object} item - 搜索结果项
 * @returns {boolean} - 是否为期货品种
 */
function isFuturesSuggestItem(item) {
  if (!item || !item.QuoteID) return false;
  // QuoteID必须是标准格式：数字点字母数字
  if (!/^\d+\.[A-Za-z0-9\-]+$/.test(String(item.QuoteID))) return false;
  // SecurityTypeName为"期货"的直接认定
  if (String(item.SecurityTypeName || '') === '期货') return true;

  // Classify字段包含期货关键词
  const classify = String(item.Classify || '');
  if (classify === 'UniversalFutures' || classify === 'Futures') return true;
  if (classify.endsWith('Futures')) return true;

  // 根据交易所代码判断（国内外主要期货交易所）
  const jys = String(item.JYS || '').toUpperCase();
  return ['SHFE', 'DCE', 'CZCE', 'INE', 'CFFEX', 'GFEX', 'COMEX', 'NYMEX', 'IPE', 'SGX', 'NYBOT', 'MDEX', 'COBOT'].includes(jys);
}

/**
 * 查询期货品种搜索建议
 * 使用东方财富搜索API获取品种列表
 * @param {string} input - 搜索关键词
 * @param {number} [count=40] - 返回数量限制
 * @returns {Promise<Array>} - 符合条件的期货品种数组
 */
async function queryFuturesSuggest(input, count = 40) {
  const keyword = String(input || '').trim();
  if (!keyword) return [];

  // 构建搜索API URL
  const url = new URL('https://searchapi.eastmoney.com/api/suggest/get');
  url.searchParams.set('input', keyword);
  url.searchParams.set('type', '14'); // 期货类型
  url.searchParams.set('count', String(count));

  // 发起请求并过滤结果
  const payload = await requestJson(url.toString(), 8000);
  const rows = payload?.QuotationCodeTable?.Data || [];
  return rows.filter(isFuturesSuggestItem);
}

/**
 * 判断输入是否为短字母代码
 * 如 AU、GC、CL 等（1-4个字母）
 * @param {string} input - 输入字符串
 * @returns {boolean} - 是否为短字母代码
 */
function isShortAlphabetCode(input) {
  return /^[A-Za-z]{1,4}$/.test(String(input || '').trim());
}

/**
 * 判断代码是否为指定前缀的国内期货合约
 * 国内期货合约格式为：前缀+年份月份（如 au2606）
 * @param {string} code - 合约代码
 * @param {string} prefix - 品种前缀（如 au）
 * @returns {boolean} - 是否匹配
 */
function isDomesticContractCode(code, prefix) {
  const text = String(code || '').trim().toLowerCase();
  const p = String(prefix || '').trim().toLowerCase();
  if (!text || !p) return false;
  // 前缀匹配，后缀必须是3-4位数字（年月）
  return text.startsWith(p) && /\d{3,4}$/.test(text.slice(p.length));
}

/**
 * 解析国内期货品种前缀，返回当前主力合约
 * 根据成交量排序，找出最活跃的合约
 * @param {string} prefix - 品种前缀（如 au、ag）
 * @returns {Promise<Object|null>} - 标准化的主力合约信息，无结果返回 null
 */
async function resolveDomesticPrefixContract(prefix) {
  const p = String(prefix || '').trim().toLowerCase();
  if (!p) return null;

  // 构建多个搜索关键词，覆盖近几年的合约
  const yy = Number(new Date().getFullYear().toString().slice(-2));
  const probeInputs = Array.from(new Set([
    `${p}2`, // 简化搜索（如 au2）
    `${p}${yy}`, // 当年（如 au26）
    `${p}${yy + 1}`, // 下一年
    `${p}${yy - 1}`, // 上一年
    `${p}`, // 仅前缀
  ]));
  const candidates = [];

  // 执行多次搜索
  for (const probe of probeInputs) {
    const rows = await queryFuturesSuggest(probe, 120);
    rows
      .filter((item) => isDomesticContractCode(item.Code, p))
      .forEach((item) => candidates.push(item));
  }

  if (!candidates.length) return null;

  // 去重，按合约代码排序（最新的优先）
  const unique = Array.from(new Map(
    candidates.map((item) => [String(item.QuoteID), item]),
  ).values());

  unique.sort((a, b) => String(b.Code || '').localeCompare(String(a.Code || '')));
  const top = unique.slice(0, 8); // 取前8个候选

  // 获取实时行情，按成交量排序找出主力合约
  const scored = await Promise.all(top.map(async (item) => {
    const normalized = normalizeQuoteCode(item.QuoteID);
    try {
      const quote = await fetchRealtimeQuote(normalized);
      return {
        item,
        normalized,
        volume: Number(quote.volume || 0),
      };
    } catch {
      return {
        item,
        normalized,
        volume: -1, // 失败的排在后面
      };
    }
  }));

  // 按成交量降序，相同成交量按代码降序
  scored.sort((a, b) => {
    if (a.volume !== b.volume) return b.volume - a.volume;
    return String(b.item.Code || '').localeCompare(String(a.item.Code || ''));
  });

  return scored[0]?.normalized || null;
}

/**
 * 解析品种代码输入
 * 支持多种输入格式：标准代码、别名、短代码、中文名称
 * 自动匹配主力合约或精确合约
 * @param {string} input - 原始输入
 * @param {Object} options - 解析选项
 * @param {string} [options.nameHint=''] - 名称提示（用于中文别名匹配）
 * @returns {Promise<Object>} - 标准化的品种信息对象
 * @throws {HttpError} - 无法解析时抛出400错误
 */
async function resolveQuoteCode(input, { nameHint = '' } = {}) {
  const rawInput = String(input || '').trim();
  if (!rawInput) {
    throw new HttpError(400, '品种代码不能为空');
  }

  const upperInput = rawInput.toUpperCase();
  // 尝试通过名称提示匹配别名
  const aliasByName = FUTURES_ALIAS_NAME_MAP[String(nameHint || '').trim()];

  // 标准格式输入（带市场代码）：直接标准化
  if (/^\d{2,3}[._-][A-Za-z0-9]+$/.test(rawInput) || /^\d{2,3}[A-Za-z0-9]+$/.test(rawInput)) {
    const normalized = normalizeQuoteCode(rawInput);
    // 短代码时，优先使用名称别名映射到主连
    if (aliasByName && String(normalized.code || '').length <= 3) {
      return normalizeQuoteCode(aliasByName);
    }
    return normalized;
  }

  // 检查代码别名映射（如 GC -> 101.GC00Y）
  const aliasByCode = FUTURES_ALIAS_CODE_MAP[upperInput];
  if (aliasByCode) {
    return normalizeQuoteCode(aliasByCode);
  }
  // 检查名称别名映射
  if (aliasByName) {
    return normalizeQuoteCode(aliasByName);
  }

  // 短字母代码（如 AU、LC）：解析为当前主力合约
  if (isShortAlphabetCode(rawInput)) {
    const resolvedDomestic = await resolveDomesticPrefixContract(rawInput);
    if (resolvedDomestic) {
      return resolvedDomestic;
    }
  }

  // 尝试搜索API匹配
  const candidates = [rawInput];
  if (nameHint && String(nameHint).trim() && String(nameHint).trim() !== rawInput) {
    candidates.push(String(nameHint).trim());
  }

  for (const candidate of candidates) {
    const rows = await queryFuturesSuggest(candidate);
    // 优先精确匹配代码
    const exact = rows.find((item) => String(item.Code || '').toUpperCase() === upperInput);
    const preferred = exact || rows[0];
    if (preferred?.QuoteID) {
      return normalizeQuoteCode(preferred.QuoteID);
    }
  }

  throw new HttpError(
    400,
    `未识别到可用期货代码: ${rawInput}。可尝试 101.GC00Y（黄金）、101.SI00Y（白银）、102.CL00Y（原油）或具体合约如 113.au2606`,
  );
}

// ============ 网络请求函数 ============

/**
 * 发起JSON请求（使用fetch API）
 * @param {string} url - 请求URL
 * @param {number} [timeoutMs=9000] - 超时时间（毫秒）
 * @returns {Promise<Object>} - JSON响应数据
 * @throws {HttpError} - 请求失败或超时时抛出错误
 */
async function requestJson(url, timeoutMs = 9000) {
  // 创建超时控制器
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (peng-stock-analysis futures-monitor)',
      },
    });

    // 检查HTTP状态
    if (!response.ok) {
      throw new HttpError(response.status, `期货行情请求失败: ${response.status}`);
    }

    // 解析JSON响应
    const payload = await response.json();
    return payload;
  } catch (error) {
    // 超时错误
    if (error?.name === 'AbortError') {
      throw new HttpError(504, '期货行情请求超时');
    }
    // HTTP错误直接抛出
    if (error instanceof HttpError) throw error;

    // 网络错误处理
    const msg = String(error?.message || '');
    const causeText = buildErrorCauseText(error);
    // fetch失败时，尝试curl降级
    if (msg.includes('fetch failed')) {
      console.error('[futures-fetch-failed]', {
        at: nowLocalDateTime(),
        remoteUrl: String(url || ''),
        timeoutMs,
        errorMessage: msg,
        errorCause: causeText || null,
      });
      if (error?.stack) {
        console.error('[futures-fetch-failed][trace]', error.stack);
      }
    }

    // 判断是否应该使用curl降级
    const causeCode = String(error?.cause?.code || '');
    const shouldFallbackByCurl = (
      /eastmoney\.com/i.test(String(url || ''))
      && (
        msg.includes('fetch failed')
        || causeCode === 'ENOTFOUND'
        || causeCode === 'ECONNRESET'
      )
    );

    // curl降级请求
    if (shouldFallbackByCurl) {
      try {
        return await requestJsonByCurl(url, timeoutMs);
      } catch (curlError) {
        const httpError = new HttpError(502, `期货行情请求异常: ${msg}; curl降级失败: ${briefErrorMessage(curlError)}`);
        attachDebugErrorMeta(httpError, {
          cause: error,
          debug: {
            url: String(url || ''),
            fetchCause: causeText || null,
            curlCause: buildErrorCauseText(curlError),
          },
        });
        throw httpError;
      }
    }

    // 无需降级，直接抛出错误
    const httpError = new HttpError(502, `期货行情请求异常: ${msg}`);
    attachDebugErrorMeta(httpError, {
      cause: error,
      debug: {
        url: String(url || ''),
        fetchCause: causeText || null,
      },
    });
    throw httpError;
  } finally {
    clearTimeout(timer);
  }
}

// ============ curl 请求辅助函数 ============

/**
 * 标准化代理URL
 * 将localhost替换为127.0.0.1，避免某些环境下的DNS问题
 * @param {string} input - 原始代理URL
 * @returns {string} - 标准化后的URL
 */
function normalizeProxyUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    // localhost替换为127.0.0.1
    if (parsed.hostname === 'localhost') {
      parsed.hostname = '127.0.0.1';
    }
    return parsed.toString();
  } catch {
    return raw.replace('://localhost', '://127.0.0.1');
  }
}

/**
 * 解析curl使用的代理URL
 * 根据请求协议（http/https）优先选择对应的环境变量代理
 * @param {string} rawUrl - 目标URL
 * @returns {string} - 解析出的代理URL，无代理返回空字符串
 */
function resolveCurlProxyUrl(rawUrl) {
  // 确定请求协议
  let protocol = 'https:';
  try {
    protocol = String(new URL(String(rawUrl || '')).protocol || 'https:');
  } catch {}

  // 根据协议优先级选择代理
  const candidates = protocol === 'http:'
    ? [
      process.env.http_proxy,
      process.env.HTTP_PROXY,
      process.env.https_proxy,
      process.env.HTTPS_PROXY,
    ]
    : [
      process.env.https_proxy,
      process.env.HTTPS_PROXY,
      process.env.http_proxy,
      process.env.HTTP_PROXY,
    ];
  return candidates
    .map((item) => normalizeProxyUrl(item))
    .find(Boolean) || '';
}

/**
 * 判断curl错误是否需要重试
 * 网络相关错误（DNS、连接、超时等）通常可以重试
 * @param {Error} error - curl错误对象
 * @returns {boolean} - 是否应该重试
 */
function shouldRetryCurlRequest(error) {
  const msg = briefErrorMessage(error, '').toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('could not resolve host')
    || msg.includes('empty reply from server')
    || msg.includes('failed to connect')
    || msg.includes('timed out')
    || msg.includes('connection reset')
    || msg.includes('tls')
    || msg.includes('ssl')
  );
}

/**
 * 使用curl发起单次JSON请求
 * 当fetch失败时的降级方案
 * @param {string} url - 请求URL
 * @param {number} [timeoutMs=9000] - 超时时间（毫秒）
 * @param {Object} options - 请求选项
 * @param {string} [options.proxyUrl=''] - 代理URL
 * @returns {Promise<Object>} - JSON响应数据
 */
async function requestJsonByCurlOnce(url, timeoutMs = 9000, { proxyUrl = '' } = {}) {
  // 转换超时时间为秒
  const seconds = Math.max(3, Math.min(20, Math.ceil(Number(timeoutMs) / 1000)));
  const args = [
    '-sS', // 静默但显示错误
    '--max-time', String(seconds),
    '-H', 'User-Agent: Mozilla/5.0 (peng-stock-analysis futures-monitor)',
    '-H', 'Accept: application/json,text/plain,*/*',
  ];

  // 代理配置
  const useProxy = Boolean(proxyUrl);
  if (useProxy) {
    args.push('--noproxy', '', '--proxy', proxyUrl);
  } else {
    args.push('--noproxy', '*', '--proxy', '');
  }
  args.push(String(url));

  // 环境变量配置（覆盖代理设置）
  const env = useProxy
    ? {
      ...process.env,
      http_proxy: proxyUrl,
      https_proxy: proxyUrl,
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
    }
    : {
      ...process.env,
      http_proxy: '',
      https_proxy: '',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
    };

  // 执行curl命令
  const { stdout } = await execFileAsync('curl', args, {
    maxBuffer: 12 * 1024 * 1024, // 最大缓冲区12MB
    env,
  });

  const text = String(stdout || '').trim();
  if (!text) {
    throw new Error('curl返回空响应');
  }

  // 解析JSON
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`curl响应非JSON: ${text.slice(0, 120)}`);
  }
}

/**
 * 使用curl发起JSON请求（带重试和代理切换）
 * @param {string} url - 请求URL
 * @param {number} [timeoutMs=9000] - 超时时间（毫秒）
 * @returns {Promise<Object>} - JSON响应数据
 */
async function requestJsonByCurl(url, timeoutMs = 9000) {
  const proxyUrl = resolveCurlProxyUrl(url);
  // 尝试策略：先直连，再代理（如果有）
  const attempts = [
    { name: 'direct', proxyUrl: '', retries: 2 },
  ];
  if (proxyUrl) {
    attempts.push({ name: 'proxy', proxyUrl, retries: 2 });
  }

  let lastError = null;
  for (const attempt of attempts) {
    for (let i = 0; i < attempt.retries; i += 1) {
      try {
        return await requestJsonByCurlOnce(url, timeoutMs, { proxyUrl: attempt.proxyUrl });
      } catch (error) {
        lastError = error;
        // 判断是否需要重试
        const shouldRetry = shouldRetryCurlRequest(error) && (i < attempt.retries - 1);
        if (!shouldRetry) break;
        // 轻量退避，减少瞬时DNS/链路抖动造成的连续失败
        await new Promise((resolve) => setTimeout(resolve, 120 * (i + 1)));
      }
    }
  }

  throw lastError || new Error('curl请求失败');
}

/**
 * 使用curl发起Buffer请求（用于获取图片或二进制数据）
 * @param {string} url - 请求URL
 * @param {number} [timeoutMs=9000] - 超时时间（毫秒）
 * @param {Object} options - 请求选项
 * @param {string} [options.referer=''] - Referer头
 * @returns {Promise<Buffer>} - Buffer响应数据
 */
async function requestBufferByCurl(url, timeoutMs = 9000, { referer = '' } = {}) {
  const proxyUrl = resolveCurlProxyUrl(url);
  const attempts = [
    { proxyUrl: '', retries: 2 },
  ];
  if (proxyUrl) {
    attempts.push({ proxyUrl, retries: 2 });
  }

  let lastError = null;
  for (const attempt of attempts) {
    for (let i = 0; i < attempt.retries; i += 1) {
      try {
        return await requestBufferByCurlOnce(url, timeoutMs, {
          referer,
          proxyUrl: attempt.proxyUrl,
        });
      } catch (error) {
        lastError = error;
        const shouldRetry = shouldRetryCurlRequest(error) && (i < attempt.retries - 1);
        if (!shouldRetry) break;
        await new Promise((resolve) => setTimeout(resolve, 120 * (i + 1)));
      }
    }
  }

  throw lastError || new Error('curl请求失败');
}

/**
 * 使用curl发起单次Buffer请求
 * @param {string} url - 请求URL
 * @param {number} [timeoutMs=9000] - 超时时间（毫秒）
 * @param {Object} options - 请求选项
 * @param {string} [options.referer=''] - Referer头
 * @param {string} [options.proxyUrl=''] - 代理URL
 * @returns {Promise<Buffer>} - Buffer响应数据
 */
async function requestBufferByCurlOnce(url, timeoutMs = 9000, { referer = '', proxyUrl = '' } = {}) {
  const seconds = Math.max(3, Math.min(20, Math.ceil(Number(timeoutMs) / 1000)));
  const args = [
    '-sS',
    '--compressed', // 启用压缩
    '--max-time', String(seconds),
    '-H', 'User-Agent: Mozilla/5.0 (peng-stock-analysis futures-monitor tencent curl)',
  ];

  // 代理配置
  const useProxy = Boolean(proxyUrl);
  if (useProxy) {
    args.push('--noproxy', '', '--proxy', proxyUrl);
  } else {
    args.push('--noproxy', '*', '--proxy', '');
  }

  // Referer头（可选）
  if (referer) {
    args.push('-H', `Referer: ${referer}`);
  }

  args.push(String(url));

  // 环境变量配置
  const env = useProxy
    ? {
      ...process.env,
      http_proxy: proxyUrl,
      https_proxy: proxyUrl,
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
    }
    : {
      ...process.env,
      http_proxy: '',
      https_proxy: '',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
    };

  // 执行curl，返回二进制数据
  const { stdout } = await execFileAsync('curl', args, {
    maxBuffer: 12 * 1024 * 1024,
    env,
    encoding: 'buffer',
  });
  const buffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || []);
  if (!buffer.length) {
    throw new Error('curl返回空响应');
  }
  return buffer;
}

/**
 * 发起文本请求（使用fetch API）
 * 用于获取JS脚本等文本资源
 * @param {string} url - 请求URL
 * @param {number} [timeoutMs=9000] - 超时时间（毫秒）
 * @returns {Promise<string>} - 文本响应
 */
async function requestText(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (peng-stock-analysis futures-monitor)',
      },
    });

    if (!response.ok) {
      throw new HttpError(response.status, `期货预设请求失败: ${response.status}`);
    }

    return response.text();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new HttpError(504, '期货预设请求超时');
    }
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, `期货预设请求异常: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// ============ 预设品种获取函数 ============

/**
 * 获取国际期货预设品种列表
 * 通过搜索API获取主连合约（后缀00Y）
 * @returns {Promise<Array>} - 预设品种数组
 */
async function fetchUniversalFuturesPresets() {
  // 搜索主连合约后缀
  const rows = await queryFuturesSuggest('00Y', 200);
  return rows
    .filter((item) => item.Classify === 'UniversalFutures' && /^\d+\.[A-Za-z0-9]+$/.test(String(item.QuoteID || '')))
    .map((item) => ({
      exchange: String(item.JYS || `MKT${item.MktNum || ''}`),
      name: String(item.Name || item.Code || item.QuoteID),
      quoteCode: String(item.QuoteID),
      source: 'eastmoney.searchapi',
      sort: 1000,
    }));
}

/**
 * 从东方财富globalfuture.js脚本解析国内期货预设品种
 * 该脚本包含国内期货交易所的品种列表
 * @param {string} [scriptText=''] - JS脚本内容
 * @returns {Array} - 解析出的预设品种数组
 */
function parseDomesticPresetsFromGlobalFutureScript(scriptText = '') {
  // 查找品种数据数组的起始标记
  const marker = 'var or=[';
  const endMarker = '];function cr';
  const start = scriptText.indexOf(marker);
  if (start < 0) return [];

  const tail = scriptText.slice(start + marker.length);
  const end = tail.indexOf(endMarker);
  if (end < 0) return [];

  const listText = tail.slice(0, end);
  const items = [];

  // 解析交易所信息
  const exchangePattern = /\{id:"([^"]+)",name:"([^"]+)",sort:(\d+),types:\[([^\]]*)\]\}/g;

  for (const match of listText.matchAll(exchangePattern)) {
    const exchangeId = String(match[1] || '').trim();
    const exchangeName = String(match[2] || '').trim();
    const exchangeSort = Number(match[3] || 999);
    const typesText = match[4] || '';

    // 解析交易所下的品种类型
    const typePattern = /\{vcode:"([^"]+)",vname:"([^"]+)"/g;
    let typeIndex = 0;
    for (const type of typesText.matchAll(typePattern)) {
      const vcode = String(type[1] || '').trim();
      const vname = String(type[2] || '').trim();
      if (!vcode || !vname) continue;

      items.push({
        exchange: `${exchangeName}(${exchangeId})`,
        name: `${vname}(自动匹配当前合约)`,
        quoteCode: vcode,
        source: 'eastmoney.globalfuture.js',
        sort: exchangeSort * 1000 + typeIndex,
      });
      typeIndex += 1;
    }
  }

  return items;
}

/**
 * 获取国内期货预设品种列表
 * 从东方财富网站获取品种配置脚本并解析
 * @returns {Promise<Array>} - 预设品种数组
 */
async function fetchDomesticFuturesPresets() {
  const script = await requestText('https://quote.eastmoney.com/newstatic/build/globalfuture.js', 12000);
  return parseDomesticPresetsFromGlobalFutureScript(script);
}

/**
 * 预设品种去重
 * 按品种代码去重，保留最早出现的记录
 * @param {Array} [rows=[]] - 原始品种数组
 * @returns {Array} - 去重后的品种数组
 */
function dedupeFuturesPresets(rows = []) {
  const map = new Map();

  rows.forEach((item) => {
    const quoteCode = String(item.quoteCode || '').trim();
    if (!quoteCode) return;
    const key = quoteCode.toUpperCase();
    if (!map.has(key)) {
      map.set(key, {
        exchange: String(item.exchange || '其他'),
        name: String(item.name || quoteCode),
        quoteCode,
        source: String(item.source || ''),
        sort: Number(item.sort || 999999),
      });
    }
  });

  return Array.from(map.values()).sort((a, b) => {
    if (a.sort !== b.sort) return a.sort - b.sort;
    if (a.exchange !== b.exchange) return a.exchange.localeCompare(b.exchange);
    return a.name.localeCompare(b.name);
  });
}

// ============ 基础数据构建函数 ============

/**
 * 构建期货基础信息对象
 * 用于存储到数据库的品种基础信息
 * @param {Object} params - 构建参数
 * @param {string} [params.quoteCode=''] - 品种代码
 * @param {number} [params.market=null] - 市场代码
 * @param {string} [params.code=''] - 合约代码
 * @param {string} [params.name=''] - 品种名称
 * @param {string} [params.exchange=''] - 交易所
 * @param {string} [params.source=''] - 数据来源
 * @param {string} [params.syncedAt=''] - 同步时间
 * @returns {Object} - 品种基础信息对象
 */
function buildFuturesBasicItem({
  quoteCode = '',
  market = null,
  code = '',
  name = '',
  exchange = '',
  source = '',
  syncedAt = '',
} = {}) {
  // 标准化品种代码
  const normalizedQuoteCode = String(quoteCode || '').trim().toUpperCase();
  // 从品种代码或参数中提取合约代码
  const rawCode = String(code || normalizedQuoteCode.split('.').pop() || '').trim().toUpperCase();
  const normalizedCode = rawCode.includes('.') ? rawCode.split('.').pop() : rawCode;
  const normalizedExchange = String(exchange || '').trim();

  return {
    quoteCode: normalizedQuoteCode,
    market: Number.isFinite(Number(market)) ? Number(market) : null,
    code: normalizedCode,
    name: String(name || '').trim() || null,
    exchange: normalizedExchange || null,
    // 从官方配置获取交易时间
    tradingHours: getOfficialFuturesTradingHours({
      quoteCode: normalizedQuoteCode,
      market,
      code: normalizedCode,
      exchange: normalizedExchange,
      name,
    }),
    source: String(source || '').trim() || null,
    syncedAt: String(syncedAt || '').trim() || null,
  };
}

// ============ 实时行情获取函数 ============

/**
 * 获取期货实时行情
 * 优先使用东方财富API，失败时降级到腾讯财经API
 * @param {Object} symbol - 标准化的品种信息
 * @returns {Promise<Object>} - 实时行情数据对象
 * @throws {HttpError} - 所有数据源都失败时抛出错误
 */
async function fetchRealtimeQuote(symbol) {
  // 构建东方财富API URL
  const url = new URL(`https://futsseapi.eastmoney.com/static/${symbol.staticCode}_qt`);
  url.searchParams.set('field', 'dm,name,p,zde,zf,o,h,l,zs,vol,amount,ccl,wp,np,utime');
  url.searchParams.set('token', FUTURES_QUOTE_TOKEN);

  try {
    // 发起东方财富请求
    const payload = await requestJson(url.toString(), 8000);
    const qt = payload?.qt || payload?.data?.qt || payload?.data || {};

    // 解析行情数据
    const price = toNum(qt.p);
    const rawPrevClose = toNum(qt.zs);
    const rawChange = toNum(qt.zde);

    // 从价格和涨跌额推导昨收价（防止数据不一致）
    const derivedPrevClose = (
      price != null
      && rawChange != null
    ) ? (price - rawChange) : null;

    let prevClose = rawPrevClose;
    if (derivedPrevClose != null) {
      // 如果昨收价与推导值不一致，使用推导值
      const inconsistent = (
        prevClose != null
        && Math.abs(prevClose - derivedPrevClose) > Math.max(Math.abs(derivedPrevClose) * 0.001, 0.01)
      );
      if (prevClose == null || inconsistent) {
        prevClose = derivedPrevClose;
      }
    }

    // 计算涨跌额和涨跌幅
    const { change, changePct } = normalizeQuoteChangeMetrics({
      price,
      prevClose,
      change: rawChange,
      changePct: qt.zf,
    });

    return {
      name: qt.name || qt.mc || symbol.code,
      code: symbol.code,
      quoteCode: symbol.quoteCode,
      market: symbol.market,
      price,
      change,
      changePct,
      open: toNum(qt.o),
      high: toNum(qt.h),
      low: toNum(qt.l),
      prevClose,
      volume: toNum(qt.vol) ?? 0,
      amount: toNum(qt.amount) ?? 0,
      openInterest: toNum(qt.ccl), // 持仓量
      bidVolume: toNum(qt.wp), // 外盘
      askVolume: toNum(qt.np), // 内盘
      tradeTime: toLocalDateTime(qt.utime, null),
      dataSource: 'eastmoney.futsseapi',
      fetchedAt: nowLocalDateTime(),
    };
  } catch (error) {
    // 东方财富失败，尝试腾讯财经降级
    const tencentCode = toTencentFuturesCode(symbol);
    if (tencentCode) {
      const tencentUrl = new URL('https://qt.gtimg.cn/');
      tencentUrl.searchParams.set('q', tencentCode);

      try {
        const response = await fetch(tencentUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (peng-stock-analysis futures-monitor tencent)',
            Referer: 'https://gu.qq.com/',
          },
        });
        if (!response.ok) {
          throw new HttpError(response.status, `腾讯期货行情请求失败: ${response.status}`);
        }

        // 腾讯返回GBK编码，需要解码
        const text = decodeGbkPayload(Buffer.from(await response.arrayBuffer()));
        const matched = text.match(new RegExp(`v_${tencentCode}="([^"]*)"`));
        if (!matched) {
          throw new HttpError(502, '腾讯期货行情数据格式异常');
        }

        // 解析腾讯行情字段（逗号分隔）
        const parts = String(matched[1] || '').split(',');
        if (parts.length < 14) {
          throw new HttpError(502, '腾讯期货行情字段不足');
        }

        const price = toNum(parts[0]);
        const prevClose = toNum(parts[7]);
        const rawChange = (
          price != null
          && prevClose != null
        ) ? (price - prevClose) : null;

        const { change, changePct } = normalizeQuoteChangeMetrics({
          price,
          prevClose,
          change: rawChange,
          changePct: parts[1],
        });

        return {
          name: String(parts[13] || '').trim() || symbol.code,
          code: symbol.code,
          quoteCode: symbol.quoteCode,
          market: symbol.market,
          price,
          change,
          changePct,
          open: toNum(parts[8]),
          high: toNum(parts[4]),
          low: toNum(parts[5]),
          prevClose,
          volume: toNum(parts[9]) ?? 0,
          amount: 0, // 腾讯不提供成交额
          openInterest: null,
          bidVolume: null,
          askVolume: null,
          tradeTime: formatTencentFuturesTradeTime(parts[12], parts[6]),
          dataSource: 'tencent.qt.futures',
          fetchedAt: nowLocalDateTime(),
        };
      } catch (fallbackError) {
        if (String(fallbackError?.message || '').includes('fetch failed')) {
          console.error('[futures-fetch-failed]', {
            at: nowLocalDateTime(),
            remoteUrl: tencentUrl.toString(),
            quoteCode: symbol?.quoteCode || null,
            tencentCode,
            errorMessage: String(fallbackError?.message || ''),
          });
          if (fallbackError?.stack) {
            console.error('[futures-fetch-failed][trace]', fallbackError.stack);
          }
        }

        try {
          const buffer = await requestBufferByCurl(tencentUrl.toString(), 8000, {
            referer: 'https://gu.qq.com/',
          });
          const text = decodeGbkPayload(buffer);
          const matched = text.match(new RegExp(`v_${tencentCode}="([^"]*)"`));
          if (!matched) {
            throw new HttpError(502, '腾讯期货行情数据格式异常');
          }

          const parts = String(matched[1] || '').split(',');
          if (parts.length < 14) {
            throw new HttpError(502, '腾讯期货行情字段不足');
          }

          const price = toNum(parts[0]);
          const prevClose = toNum(parts[7]);
          const rawChange = (
            price != null
            && prevClose != null
          ) ? (price - prevClose) : null;
          const { change, changePct } = normalizeQuoteChangeMetrics({
            price,
            prevClose,
            change: rawChange,
            changePct: parts[1],
          });

          return {
            name: String(parts[13] || '').trim() || symbol.code,
            code: symbol.code,
            quoteCode: symbol.quoteCode,
            market: symbol.market,
            price,
            change,
            changePct,
            open: toNum(parts[8]),
            high: toNum(parts[4]),
            low: toNum(parts[5]),
            prevClose,
            volume: toNum(parts[9]) ?? 0,
            amount: 0,
            openInterest: null,
            bidVolume: null,
            askVolume: null,
            tradeTime: formatTencentFuturesTradeTime(parts[12], parts[6]),
            dataSource: 'tencent.qt.futures',
            fetchedAt: nowLocalDateTime(),
          };
        } catch (curlError) {
          console.error('[futures-fetch-failed][curl]', {
            at: nowLocalDateTime(),
            remoteUrl: tencentUrl.toString(),
            quoteCode: symbol?.quoteCode || null,
            tencentCode,
            errorMessage: String(curlError?.message || ''),
          });
          if (curlError?.stack) {
            console.error('[futures-fetch-failed][curl-trace]', curlError.stack);
          }
        }
      }
    }

    throw error;
  }
}

/**
 * 从K线数据构建行情回退数据
 * 当实时行情不可用时，使用K线末值估算行情
 * @param {Object} symbol - 标准化的品种信息
 * @param {Array} [candles=[]] - K线数据数组
 * @returns {Object|null} - 估算的行情对象，无数据返回 null
 */
function buildQuoteFallbackFromCandles(symbol, candles = []) {
  const list = Array.isArray(candles) ? candles.filter(Boolean) : [];
  if (!list.length) return null;

  // 取最后两根K线用于估算
  const last = list[list.length - 1];
  const prev = list.length > 1 ? list[list.length - 2] : null;
  const price = toNum(last?.close);
  if (price == null) return null;

  // 使用前一根K线收盘价作为昨收价（或当前开盘价）
  const prevClose = toNum(prev?.close) ?? toNum(last?.open);

  const { change, changePct } = normalizeQuoteChangeMetrics({
    price,
    prevClose,
    change: prevClose != null ? (price - prevClose) : null,
    changePct: null,
  });

  return {
    name: symbol.code,
    code: symbol.code,
    quoteCode: symbol.quoteCode,
    market: symbol.market,
    price,
    change,
    changePct,
    open: toNum(last?.open),
    high: toNum(last?.high),
    low: toNum(last?.low),
    prevClose: prevClose ?? null,
    volume: toNum(last?.volume) ?? 0,
    amount: toNum(last?.amount) ?? 0,
    openInterest: null,
    bidVolume: null,
    askVolume: null,
    tradeTime: toLocalDateTime(last?.date, null),
    dataSource: 'local.candles.fallback',
    fetchedAt: nowLocalDateTime(),
  };
}

/**
 * 获取期货K线数据
 * 从东方财富API获取指定时间粒度的K线数据
 * @param {Object} symbol - 标准化的品种信息
 * @param {Object} options - 获取选项
 * @param {string} [options.timeframe='60m'] - 时间粒度
 * @param {number} [options.limit=120] - K线数量限制
 * @returns {Promise<Array>} - K线数据数组
 * @throws {HttpError} - 不支持的时间粒度或无数据时抛出错误
 */
async function fetchKline(symbol, { timeframe = '60m', limit = 120 } = {}) {
  const frame = FUTURES_TIMEFRAME_MAP[timeframe];
  // 检查时间粒度是否支持API请求
  if (!frame || !frame.code) {
    throw new HttpError(400, `不支持的时间粒度: ${timeframe}`);
  }

  // 标准化限制值
  const normalizedLimit = Math.min(Math.max(Number(limit) || 120, 30), 2500);

  // 对1分钟K线，从昨天开始取数据（覆盖夜盘品种）
  const isIntraday1m = timeframe === '1m';
  let begParam = '0';
  if (isIntraday1m) {
    const yesterday = new Date(Date.now() - 86400000);
    const y = yesterday.getFullYear();
    const m = String(yesterday.getMonth() + 1).padStart(2, '0');
    const d = String(yesterday.getDate()).padStart(2, '0');
    begParam = `${y}${m}${d}`;
  }

  // 构建K线API URL
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');
  url.searchParams.set('secid', symbol.secid);
  url.searchParams.set('ut', FUTURES_HISTORY_UT);
  url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6');
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58');
  url.searchParams.set('klt', frame.code); // K线类型代码
  url.searchParams.set('fqt', '0'); // 不复权
  url.searchParams.set('beg', begParam); // 开始日期
  url.searchParams.set('end', '20500101'); // 结束日期
  url.searchParams.set('lmt', String(normalizedLimit));

  // 发起请求并解析K线数据
  const payload = await requestJson(url.toString(), 9000);
  const rows = payload?.data?.klines || [];
  let candles = rows.map(parseKlineRow).filter(Boolean);

  // 对1分钟K线填充缺口
  if (isIntraday1m) {
    candles = fillIntradayCandleGaps(candles, timeframe, { latestDayOnly: true });
  }

  if (!candles.length) {
    throw new HttpError(404, `未获取到 ${symbol.quoteCode} 的K线数据`);
  }

  return candles.slice(-normalizedLimit);
}

/**
 * 获取期货成交明细数据
 * 用于生成30秒K线或其他高频数据
 * @param {Object} symbol - 标准化的品种信息
 * @param {Object} options - 获取选项
 * @param {number} [options.limit=600] - 成交明细数量限制
 * @returns {Promise<Array>} - 成交明细数组
 * @throws {HttpError} - 无数据时抛出错误
 */
async function fetchTickMx(symbol, { limit = 600 } = {}) {
  const normalized = Math.min(Math.max(Number(limit) || 600, 60), 1999);

  // 构建成交明细API URL
  const url = new URL(`https://futsseapi.eastmoney.com/static/${symbol.staticCode}_mx/${normalized}`);
  url.searchParams.set('token', FUTURES_QUOTE_TOKEN);

  const payload = await requestJson(url.toString(), 8000);
  const rows = payload?.mx || [];
  if (!rows.length) {
    throw new HttpError(404, `未获取到 ${symbol.quoteCode} 的成交明细`);
  }

  // 解析成交明细数据
  return rows
    .map((item) => ({
      ts: Number(item.utime), // 时间戳
      price: toNum(item.p), // 成交价格
      volume: toNum(item.vol) ?? 0, // 成交量
    }))
    .filter((item) => Number.isFinite(item.ts) && Number.isFinite(item.price) && item.price > 0)
    .sort((a, b) => a.ts - b.ts);
}

/**
 * 将成交明细聚合为K线数据
 * 按指定时间粒度聚合成交明细，生成K线
 * @param {Array} ticks - 成交明细数组
 * @param {string} timeframe - 目标时间粒度
 * @param {number} limit - K线数量限制
 * @returns {Array} - 聚合后的K线数据数组
 */
function aggregateTicksToCandles(ticks, timeframe, limit) {
  // 时间粒度对应的分钟数
  const intervalMap = {
    '30s': 0.5,
    '1m': 1,
    '5m': 5,
    '15m': 15,
    '30m': 30,
    '60m': 60,
    '1d': 1440,
    '1w': 10080,
    '1M': 43200,
  };
  const intervalMinutes = intervalMap[timeframe] || 60;
  const bucketSpan = intervalMinutes * 60; // 时间桶跨度（秒）

  // 按时间桶聚合成交明细
  const buckets = new Map();
  ticks.forEach((tick) => {
    // 计算成交所属的时间桶
    const bucketTs = Math.floor(tick.ts / bucketSpan) * bucketSpan;
    const existing = buckets.get(bucketTs);

    if (!existing) {
      // 新桶：初始化K线数据
      buckets.set(bucketTs, {
        ts: bucketTs,
        date: toDateString(bucketTs, intervalMinutes),
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.volume,
        amount: (tick.price || 0) * (tick.volume || 0),
      });
      return;
    }

    // 已有桶：更新K线数据
    existing.high = Math.max(existing.high, tick.price);
    existing.low = Math.min(existing.low, tick.price);
    existing.close = tick.price; // 最新成交价作为收盘价
    existing.volume += tick.volume || 0;
    existing.amount += (tick.price || 0) * (tick.volume || 0);
  });

  const normalizedLimit = Math.max(Number(limit) || 120, 20);
  let rawCandles = Array.from(buckets.values()).sort((a, b) => a.ts - b.ts);
  if (!rawCandles.length) return [];

  if (timeframe === '1m') {
    const latestDay = String(rawCandles[rawCandles.length - 1]?.date || '').slice(0, 10);
    const latestDayCandles = rawCandles.filter((item) => String(item?.date || '').slice(0, 10) === latestDay);
    if (latestDayCandles.length) {
      rawCandles = latestDayCandles;
    }
  }

  const shouldFillIntradayGaps = ['30s', '1m', '5m', '15m', '30m', '60m'].includes(String(timeframe || ''));
  let finalCandles = rawCandles;

  if (shouldFillIntradayGaps) {
    const byTs = new Map(rawCandles.map((item) => [item.ts, item]));
    const first = rawCandles[0];
    const last = rawCandles[rawCandles.length - 1];
    const endTs = last.ts;
    const startTs = first.ts;

    const continuous = [];
    let prevClose = first.close;
    for (let ts = startTs; ts <= endTs; ts += bucketSpan) {
      const hit = byTs.get(ts);
      if (hit) {
        continuous.push(hit);
        prevClose = hit.close;
      } else {
        continuous.push({
          ts,
          date: toDateString(ts, intervalMinutes),
          open: prevClose,
          high: prevClose,
          low: prevClose,
          close: prevClose,
          volume: 0,
          amount: 0,
        });
      }
    }
    finalCandles = continuous;
  }

  return finalCandles
    .slice(-normalizedLimit)
    .map((item) => ({
      date: item.date,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume,
      amount: item.amount,
    }));
}

// ============ K线获取（带降级）函数 ============

/**
 * 获取K线数据（带降级方案）
 * 优先使用K线API，失败时降级为成交明细聚合
 * 30秒K线直接使用成交明细聚合（API不支持）
 * @param {Object} symbol - 标准化的品种信息
 * @param {Object} options - 获取选项
 * @param {string} [options.timeframe='60m'] - 时间粒度
 * @param {number} [options.limit=120] - K线数量限制
 * @returns {Promise<Object>} - 包含K线数据和元信息的结果对象
 */
async function fetchCandlesWithFallback(symbol, { timeframe = '60m', limit = 120 } = {}) {
  // 30秒K线：API不支持，直接聚合成交明细
  if (timeframe === '30s') {
    const ticks = await fetchTickMx(symbol, {
      limit: Math.min(Math.max(limit * 8, 180), 1999),
    });
    return {
      candles: aggregateTicksToCandles(ticks, timeframe, limit),
      candleDataSource: 'eastmoney.futsseapi.mx',
      degraded: false,
      warning: null,
    };
  }

  // 尝试K线API
  try {
    const candles = await fetchKline(symbol, { timeframe, limit });
    return {
      candles,
      candleDataSource: 'eastmoney.push2his',
      degraded: false,
      warning: null,
    };
  } catch (error) {
    // 记录K线API失败
    logFuturesMonitorIssue({
      level: 'warn',
      stage: 'kline-primary-failed',
      symbol,
      timeframe,
      limit,
      error,
      extra: { fallback: 'tick-mx-aggregate' },
    });

    // 长周期K线不使用降级方案（聚合精度不足）
    if (FUTURES_LONG_KLINE_KEYS.has(String(timeframe || ''))) {
      throw error;
    }

    // 尝试成交明细降级方案
    let ticks = [];
    try {
      ticks = await fetchTickMx(symbol, {
        limit: Math.min(Math.max(limit * 20, 180), 1999),
      });
    } catch (fallbackError) {
      // 成交明细降级也失败
      logFuturesMonitorIssue({
        level: 'error',
        stage: 'tick-fallback-failed',
        symbol,
        timeframe,
        limit,
        error: fallbackError,
        extra: { primaryError: error?.message || '未知错误' },
      });
      throw fallbackError;
    }

    // 聚合成交明细为K线
    const candles = aggregateTicksToCandles(ticks, timeframe, limit);
    if (!candles.length) {
      logFuturesMonitorIssue({
        level: 'error',
        stage: 'tick-fallback-empty',
        symbol,
        timeframe,
        limit,
        error,
      });
      throw error;
    }

    return {
      candles,
      candleDataSource: 'eastmoney.futsseapi.mx',
      degraded: true,
      warning: `K线接口不可用，已降级为成交明细聚合: ${error.message}`,
    };
  }
}

// ============ 监测看板辅助函数 ============

/**
 * 按分类分组品种列表
 * 将品种归类到各自的分类下
 * @param {Array} categories - 分类数组
 * @param {Array} symbols - 品种数组
 * @returns {Array} - 分组后的分类数组（每个分类包含symbols字段）
 */
function groupSymbolsByCategory(categories, symbols) {
  // 创建分类映射
  const map = new Map(categories.map((category) => [category.id, { ...category, symbols: [] }]));
  // 将品种分配到对应分类
  symbols.forEach((symbol) => {
    const category = map.get(symbol.categoryId);
    if (category) {
      category.symbols.push(symbol);
    }
  });
  return Array.from(map.values());
}

/**
 * 标准化监测品种代码令牌
 * 用于品种代码比较和匹配
 * @param {string} input - 原始输入
 * @returns {string} - 标准化后的品种代码令牌
 */
function normalizeMonitorQuoteCodeToken(input) {
  const text = String(input || '')
    .trim()
    .replace(/\s+/g, '');
  if (!text) return '';
  try {
    return normalizeQuoteCode(text).quoteCode.toUpperCase();
  } catch {
    // 无法解析时，简单替换分隔符
    return text.toUpperCase().replace(/[._-]/g, '.');
  }
}

/**
 * 解析监测请求中的品种代码参数
 * 支持多种输入格式：单个代码、数组、逗号分隔等
 * @param {*} input - 输入参数（可以是字符串、数组等）
 * @returns {Array} - 解析后的品种代码数组（去重）
 */
function parseMonitorQuoteCodes(input) {
  if (input === undefined || input === null || input === '') return [];

  // 支持数组输入
  const values = Array.isArray(input) ? input : [input];

  // 按分隔符拆分并标准化
  const tokens = values
    .flatMap((item) => String(item || '').split(/[\s,;|]+/))
    .map((item) => normalizeMonitorQuoteCodeToken(item))
    .filter(Boolean);

  // 去重
  return Array.from(new Set(tokens));
}

function hasUsableFuturesIntradayCandles(candles = [], minPoints = 8) {
  if (!Array.isArray(candles) || !candles.length) return false;
  const valid = candles.filter((item) => {
    const close = Number(item?.close);
    return Number.isFinite(close) && close > 0;
  }).length;
  return valid >= Math.max(1, Number(minPoints) || 1);
}

async function fallbackThirtySecondsCandles(candlesResult, normalized, limit) {
  if (candlesResult?.ok && hasUsableFuturesIntradayCandles(candlesResult.data?.candles || [], 8)) {
    return candlesResult;
  }

  const minuteLimit = Math.max(Number(limit) || 120, 120);
  const minuteResult = await fetchCandlesWithFallback(normalized, { timeframe: '1m', limit: minuteLimit })
    .then((data) => ({ ok: true, data }))
    .catch((error) => ({ ok: false, error }));

  if (!minuteResult.ok) return candlesResult;

  const mergedCandles = mergeAndPersistIntradayCandles({
    quoteCode: normalized.quoteCode,
    timeframe: '1m',
    limit: minuteLimit,
    candles: minuteResult.data?.candles || [],
    source: minuteResult.data?.candleDataSource || null,
  });

  const warningParts = [];
  if (candlesResult?.ok && candlesResult.data?.warning) warningParts.push(candlesResult.data.warning);
  if (!candlesResult?.ok && candlesResult?.error?.message) {
    warningParts.push(`30秒K线接口不可用，已切换1分钟数据: ${candlesResult.error.message}`);
  }
  if (candlesResult?.ok && !hasUsableFuturesIntradayCandles(candlesResult.data?.candles || [], 8)) {
    warningParts.push('30秒K线数据较少，已切换1分钟数据');
  }
  if (minuteResult.data?.warning) warningParts.push(minuteResult.data.warning);
  warningParts.push('30秒K线暂使用1分钟数据近似');

  return {
    ok: true,
    data: {
      candles: mergedCandles.slice(-minuteLimit),
      candleDataSource: `${minuteResult.data?.candleDataSource || 'unknown'}+alias.30s<-1m`,
      degraded: true,
      warning: warningParts.filter(Boolean).join(' | ') || null,
    },
  };
}

// ============ 导出的服务方法 ============

/**
 * 期货服务对象
 * 提供期货相关的核心业务方法
 */
export const futuresService = {
  /**
   * 获取支持的时间粒度列表
   * @returns {Array} - 时间粒度数组，每项包含 key、label、code
   */
  getTimeframes() {
    return Object.entries(FUTURES_TIMEFRAME_MAP).map(([key, item]) => ({
      key,
      label: item.label,
      code: item.code,
    }));
  },

  /**
   * 解析品种代码
   * @param {string} input - 原始输入
   * @param {Object} options - 解析选项
   * @param {string} [options.nameHint=''] - 名称提示
   * @returns {Promise<Object>} - 标准化的品种信息
   */
  async resolveSymbol(input, { nameHint = '' } = {}) {
    return resolveQuoteCode(input, { nameHint });
  },

  /**
   * 根据品种代码列表获取监测数据
   * 不依赖数据库分类配置，直接按品种代码查询
   * @param {Object} payload - 请求参数
   * @param {string|Array} [payload.quoteCode] - 品种代码（支持单个或数组）
   * @param {string} [payload.code] - 品种代码别名
   * @param {string|Array} [payload.quoteCodes] - 品种代码数组
   * @param {string} [payload.timeframe='30s'] - 时间粒度
   * @param {number} [payload.limit] - K线数量限制
   * @param {Object} [payload.nameMap] - 品种名称映射
   * @returns {Promise<Object>} - 监测数据对象
   */
  async getMonitorByQuoteCodes(payload = {}) {
    // 解析品种代码参数
    const quoteCodes = parseMonitorQuoteCodes([
      payload.quoteCode,
      payload.code,
      payload.quoteCodes,
    ]);
    const timeframe = String(payload.timeframe || '30s');

    // 计算K线数量限制
    const hasExplicitLimit = payload.limit !== undefined && payload.limit !== null && payload.limit !== '';
    const defaultLimit = FUTURES_MONITOR_DEFAULT_LIMIT_MAP[timeframe]
      || (FUTURES_LONG_KLINE_KEYS.has(timeframe) ? 100 : 120);
    const parsedLimit = Number(hasExplicitLimit ? payload.limit : defaultLimit);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : defaultLimit;

    // 验证时间粒度
    if (!FUTURES_TIMEFRAME_MAP[timeframe]) {
      throw new HttpError(400, `不支持的时间粒度: ${timeframe}`);
    }

    // 无品种代码时返回空结果
    if (!quoteCodes.length) {
      return {
        timeframe,
        timeframeLabel: FUTURES_TIMEFRAME_MAP[timeframe].label,
        total: 0,
        success: 0,
        failed: 0,
        categories: [],
        quoteCodes: [],
        items: [],
      };
    }

    // 构建品种信息数组
    const symbols = quoteCodes.map((quoteCode) => {
      const normalized = normalizeQuoteCode(quoteCode);
      return {
        id: normalized.quoteCode,
        categoryId: null,
        categoryName: '-',
        name: String(payload.nameMap?.[normalized.quoteCode] || normalized.code || normalized.quoteCode).trim(),
        quoteCode: normalized.quoteCode,
        market: normalized.market,
        code: normalized.code,
        tradingHours: getOfficialFuturesTradingHours(normalized),
      };
    });

    const items = await Promise.all(symbols.map(async (symbol) => {
      const normalized = normalizeQuoteCode(symbol.quoteCode || `${symbol.market}.${symbol.code}`);
      const quotePromise = fetchRealtimeQuote(normalized)
        .then((data) => ({ ok: true, data }))
        .catch((error) => ({ ok: false, error }));
      const isLongTimeframe = FUTURES_LONG_KLINE_KEYS.has(timeframe);
      const rawCandlesResult = isLongTimeframe
        ? { ok: false, error: new Error('long-local-first') }
        : await fetchCandlesWithFallback(normalized, { timeframe, limit })
          .then((data) => ({ ok: true, data }))
          .catch((error) => ({ ok: false, error }));
      const quoteResult = await quotePromise;
      let candlesResult = rawCandlesResult;
      let finalQuote = quoteResult.ok ? quoteResult.data : null;

      const warningList = [];
      const errorList = [];
      const quoteErrorText = quoteResult.ok ? '' : `实时行情失败: ${quoteResult.error?.message || '未知错误'}`;

      if (timeframe === '30s') {
        candlesResult = await fallbackThirtySecondsCandles(candlesResult, normalized, limit);
      }

      if (timeframe === '1m') {
        if (candlesResult.ok) {
          const mergedCandles = mergeAndPersistIntradayCandles({
            quoteCode: normalized.quoteCode,
            timeframe,
            limit,
            candles: candlesResult.data.candles || [],
            source: candlesResult.data.candleDataSource || null,
          });
          candlesResult = {
            ...candlesResult,
            data: {
              ...candlesResult.data,
              candles: mergedCandles,
              candleDataSource: candlesResult.data.candleDataSource === LOCAL_INTRADAY_DATA_SOURCE
                ? LOCAL_INTRADAY_DATA_SOURCE
                : `${candlesResult.data.candleDataSource || 'unknown'}+${LOCAL_INTRADAY_DATA_SOURCE}`,
            },
          };
        } else {
          const cachedCandles = loadIntradayCandlesFromStore({
            quoteCode: normalized.quoteCode,
            timeframe,
            limit,
          });
          if (cachedCandles.length) {
            candlesResult = {
              ok: true,
              data: {
                candles: cachedCandles,
                candleDataSource: LOCAL_INTRADAY_DATA_SOURCE,
                degraded: true,
                warning: `K线接口不可用，已回退本地缓存: ${rawCandlesResult.error?.message || '未知错误'}`,
              },
            };
          }
        }
      } else if (FUTURES_LONG_KLINE_KEYS.has(timeframe)) {
        let localCandles = loadLongCandlesFromStore({
          quoteCode: normalized.quoteCode,
          timeframe,
          limit,
        });
        const currentDerived = buildCurrentLongCandleFromMinuteStore({
          quoteCode: normalized.quoteCode,
          timeframe,
        });
        if (currentDerived) {
          localCandles = mergeAndPersistLongCandles({
            quoteCode: normalized.quoteCode,
            timeframe,
            limit,
            candles: [currentDerived],
            source: LOCAL_DERIVED_INTRADAY_SOURCE,
          });
        }

        const cacheComplete = isLongCacheComplete(localCandles, timeframe, limit);
        if (!cacheComplete) {
          triggerLongKlineBackgroundSync({
            normalized,
            timeframe,
            limit,
          });
        }

        if (localCandles.length) {
          candlesResult = {
            ok: true,
            data: {
              candles: localCandles,
              candleDataSource: LOCAL_INTRADAY_DATA_SOURCE,
              degraded: !cacheComplete,
              warning: cacheComplete ? null : 'K线优先展示本地缓存，后台正在补齐远程数据',
            },
          };
        } else {
          triggerLongKlineBackgroundSync({
            normalized,
            timeframe,
            limit,
          });
          candlesResult = {
            ok: false,
            error: new Error('本地暂无K线缓存，后台已启动补齐任务'),
          };
        }
      }

      if (!candlesResult.ok) {
        if (candlesResult.error?.message !== 'long-local-first') {
          logFuturesMonitorIssue({
            level: 'error',
            stage: 'candles-final-failed',
            symbol: normalized,
            timeframe,
            limit,
            error: candlesResult.error,
          });
        }
        errorList.push(`K线失败: ${candlesResult.error?.message || '未知错误'}`);
      } else if (candlesResult.data.warning) {
        warningList.push(candlesResult.data.warning);
      }

      if (!finalQuote && candlesResult.ok) {
        const fallbackQuote = buildQuoteFallbackFromCandles(normalized, candlesResult.data.candles || []);
        if (fallbackQuote) {
          finalQuote = fallbackQuote;
          if (quoteErrorText) {
            warningList.push(`实时行情不可用，已使用本地K线末值估算: ${quoteResult.error?.message || '未知错误'}`);
          }
        }
      }

      if (!finalQuote && quoteErrorText) {
        logFuturesMonitorIssue({
          level: 'error',
          stage: 'quote-final-failed',
          symbol: normalized,
          timeframe,
          limit,
          error: quoteResult.error,
        });
        errorList.push(quoteErrorText);
      } else if (!quoteResult.ok && finalQuote) {
        logFuturesMonitorIssue({
          level: 'warn',
          stage: 'quote-failed-fallback-used',
          symbol: normalized,
          timeframe,
          limit,
          error: quoteResult.error,
          extra: { quoteDataSource: finalQuote?.dataSource || null },
        });
      }

      return {
        id: symbol.id,
        categoryId: symbol.categoryId,
        categoryName: symbol.categoryName || '-',
        name: symbol.name,
        quoteCode: normalized.quoteCode,
        market: normalized.market,
        code: normalized.code,
        tradingHours: symbol.tradingHours || getOfficialFuturesTradingHours(normalized),
        timeframe,
        timeframeLabel: FUTURES_TIMEFRAME_MAP[timeframe].label,
        quote: finalQuote,
        candles: candlesResult.ok ? candlesResult.data.candles : [],
        candleDataSource: candlesResult.ok ? candlesResult.data.candleDataSource : null,
        warning: warningList.length ? warningList.join(' | ') : null,
        error: errorList.length ? errorList.join(' | ') : null,
      };
    }));

    const success = items.filter((item) => !item.error).length;
    const failed = items.length - success;

    return {
      timeframe,
      timeframeLabel: FUTURES_TIMEFRAME_MAP[timeframe].label,
      total: items.length,
      success,
      failed,
      categories: [],
      quoteCodes,
      items,
      fetchedAt: nowLocalDateTime(),
      failOpen: true,
    };
  },

  /**
   * 获取预设品种列表
   * 从东方财富获取国际和国内期货品种列表，支持缓存
   * @param {Object} options - 获取选项
   * @param {boolean} [options.force=false] - 是否强制刷新（忽略缓存）
   * @returns {Promise<Object>} - 预设品种数据对象
   */
  async listPresets({ force = false } = {}) {
    const now = Date.now();

    // 检查缓存是否有效
    const cacheAlive = futuresPresetCache.items.length > 0
      && (now - futuresPresetCache.updatedAt) < FUTURES_PRESET_CACHE_TTL_MS;

    // 使用缓存
    if (!force && cacheAlive) {
      return {
        items: futuresPresetCache.items,
        total: futuresPresetCache.items.length,
        cached: true,
        updatedAt: toLocalDateTime(new Date(futuresPresetCache.updatedAt), nowLocalDateTime()),
      };
    }

    // 并行获取国际和国内期货预设
    const [universalResult, domesticResult] = await Promise.allSettled([
      fetchUniversalFuturesPresets(),
      fetchDomesticFuturesPresets(),
    ]);

    const universal = universalResult.status === 'fulfilled' ? universalResult.value : [];
    const domestic = domesticResult.status === 'fulfilled' ? domesticResult.value : [];

    // 合并并去重
    let items = dedupeFuturesPresets([
      ...universal,
      ...domestic,
    ]);

    // 全部失败时使用备选列表
    if (!items.length) {
      items = dedupeFuturesPresets(FUTURES_PRESET_FALLBACK);
    }

    const syncedAt = toLocalDateTime(new Date(now), nowLocalDateTime());

    // 补充交易时间信息
    const enrichedItems = items.map((item) => {
      const basic = buildFuturesBasicItem({
        quoteCode: item.quoteCode,
        code: item.quoteCode,
        name: item.name,
        exchange: item.exchange,
        source: item.source,
        syncedAt,
      });
      return {
        ...item,
        tradingHours: basic.tradingHours,
      };
    });

    // 持久化到数据库
    futuresBasicsRepository.upsertMany(enrichedItems.map((item) => buildFuturesBasicItem({
      quoteCode: item.quoteCode,
      code: item.quoteCode,
      name: item.name,
      exchange: item.exchange,
      source: item.source,
      syncedAt,
    })));

    // 更新缓存
    futuresPresetCache.items = enrichedItems;
    futuresPresetCache.updatedAt = now;

    return {
      items: enrichedItems,
      total: enrichedItems.length,
      cached: false,
      updatedAt: syncedAt,
      dataSource: {
        universal: universalResult.status === 'fulfilled' ? 'eastmoney.searchapi' : null,
        domestic: domesticResult.status === 'fulfilled' ? 'eastmoney.globalfuture.js' : null,
      },
    };
  },

  /**
   * 获取分类列表（含品种信息）
   * 从数据库加载分类和品种配置，合并基础信息
   * @returns {Array} - 分类数组，每项包含symbols字段
   */
  listCategories() {
    // 从数据库加载分类和品种
    const categories = futuresRepository.listCategories();
    const symbols = futuresRepository.listSymbols({ onlyActive: false });

    // 加载基础信息并构建映射
    const basicsMap = new Map(
      futuresBasicsRepository.findByQuoteCodes(symbols.map((item) => item.quoteCode)).map((item) => [item.quoteCode, item]),
    );

    // 补充交易时间和交易所信息
    const enrichedSymbols = symbols.map((symbol) => {
      const basic = basicsMap.get(String(symbol.quoteCode || '').trim().toUpperCase());
      return {
        ...symbol,
        tradingHours: basic?.tradingHours || getOfficialFuturesTradingHours(symbol),
        exchange: basic?.exchange || null,
      };
    });

    return groupSymbolsByCategory(categories, enrichedSymbols);
  },

  /**
   * 创建新分类
   * @param {Object} payload - 分类参数
   * @param {string} payload.name - 分类名称
   * @param {string} [payload.description] - 分类描述
   * @param {number} [payload.sortOrder=100] - 排序值
   * @param {boolean} [payload.isEnabled=true] - 是否启用
   * @returns {Object} - 创建的分类对象
   * @throws {HttpError} - 名称重复时抛出409错误
   */
  createCategory(payload = {}) {
    const name = String(payload.name || '').trim();
    const description = String(payload.description || '').trim();
    const sortOrder = Number(payload.sortOrder || 100);
    const isEnabled = toBool(payload.isEnabled, true);

    if (!name) {
      throw new HttpError(400, '分类名称不能为空');
    }

    try {
      return futuresRepository.createCategory({
        name,
        description,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 100,
        isEnabled,
      });
    } catch (error) {
      // UNIQUE约束违反：分类已存在
      if (String(error.message || '').includes('UNIQUE')) {
        throw new HttpError(409, `分类已存在: ${name}`);
      }
      throw error;
    }
  },

  /**
   * 更新分类信息
   * @param {number} categoryId - 分类ID
   * @param {Object} payload - 更新参数
   * @param {string} [payload.name] - 分类名称
   * @param {string} [payload.description] - 分类描述
   * @param {number} [payload.sortOrder] - 排序值
   * @param {boolean} [payload.isEnabled] - 是否启用
   * @returns {Object} - 更新后的分类对象
   * @throws {HttpError} - 分类不存在或名称重复时抛出错误
   */
  updateCategory(categoryId, payload = {}) {
    const id = Number(categoryId);
    if (!Number.isFinite(id) || id <= 0) {
      throw new HttpError(400, 'categoryId 非法');
    }

    // 检查分类是否存在
    const existing = futuresRepository.getCategoryById(id);
    if (!existing) {
      throw new HttpError(404, `分类不存在: ${id}`);
    }

    // 判断是否提供了各字段
    const hasName = Object.prototype.hasOwnProperty.call(payload, 'name');
    const hasDescription = Object.prototype.hasOwnProperty.call(payload, 'description');
    const hasSortOrder = Object.prototype.hasOwnProperty.call(payload, 'sortOrder');
    const hasEnabled = Object.prototype.hasOwnProperty.call(payload, 'isEnabled');

    // 使用新值或保留旧值
    const name = String(hasName ? payload.name : (existing.name || '')).trim();
    const rawDescription = hasDescription ? payload.description : existing.description;
    const description = String(rawDescription || '').trim();
    const sortOrder = Number(hasSortOrder ? payload.sortOrder : (existing.sortOrder ?? 100));
    const isEnabled = toBool(hasEnabled ? payload.isEnabled : existing.isEnabled, existing.isEnabled !== false);

    if (!name) {
      throw new HttpError(400, '分类名称不能为空');
    }

    try {
      return futuresRepository.updateCategory(id, {
        name,
        description,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 100,
        isEnabled,
      });
    } catch (error) {
      if (String(error.message || '').includes('UNIQUE')) {
        throw new HttpError(409, `分类已存在: ${name}`);
      }
      throw error;
    }
  },

  /**
   * 删除分类
   * 删除分类及其下的所有品种
   * @param {number} categoryId - 分类ID
   * @returns {Object} - 被删除的分类信息（含品种数量）
   * @throws {HttpError} - 分类不存在时抛出404错误
   */
  deleteCategory(categoryId) {
    const id = Number(categoryId);
    if (!Number.isFinite(id) || id <= 0) {
      throw new HttpError(400, 'categoryId 非法');
    }

    // 检查分类是否存在
    const existing = futuresRepository.getCategoryById(id);
    if (!existing) {
      throw new HttpError(404, `分类不存在: ${id}`);
    }

    // 获取分类下的品种数量（用于返回信息）
    const symbolCount = futuresRepository.listSymbols({
      categoryId: id,
      onlyActive: false,
    }).length;

    // 删除分类（品种会通过外键级联删除）
    futuresRepository.deleteCategory(id);

    return {
      ...existing,
      symbolCount,
    };
  },

  /**
   * 创建新品种
   * @param {Object} payload - 品种参数
   * @param {number} payload.categoryId - 所属分类ID
   * @param {string} payload.quoteCode - 品种代码
   * @param {string} [payload.name] - 品种名称（可选，默认使用代码）
   * @param {number} [payload.sortOrder=100] - 排序值
   * @param {boolean} [payload.isActive=true] - 是否启用
   * @returns {Promise<Object>} - 创建的品种对象
   * @throws {HttpError} - 分类不存在或品种代码无效时抛出错误
   */
  async createSymbol(payload = {}) {
    const categoryId = Number(payload.categoryId);
    if (!Number.isFinite(categoryId) || categoryId <= 0) {
      throw new HttpError(400, 'categoryId 非法');
    }

    // 检查分类是否存在
    const category = futuresRepository.getCategoryById(categoryId);
    if (!category) {
      throw new HttpError(404, `分类不存在: ${categoryId}`);
    }

    // 解析品种代码
    const normalized = await resolveQuoteCode(payload.quoteCode, {
      nameHint: payload.name,
    });
    const name = String(payload.name || '').trim() || normalized.code;
    const sortOrder = Number(payload.sortOrder || 100);

    try {
      // 创建品种记录
      const created = futuresRepository.createSymbol({
        categoryId,
        name,
        quoteCode: normalized.quoteCode,
        market: normalized.market,
        code: normalized.code,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 100,
        isActive: payload.isActive !== false,
      });

      // 同步基础信息到数据库
      futuresBasicsRepository.upsertOne(buildFuturesBasicItem({
        quoteCode: normalized.quoteCode,
        market: normalized.market,
        code: normalized.code,
        name,
        exchange: payload.exchange || '',
        source: 'futures.createSymbol',
        syncedAt: nowLocalDateTime(),
      }));
      return {
        ...created,
        tradingHours: getOfficialFuturesTradingHours(normalized),
      };
    } catch (error) {
      if (String(error.message || '').includes('UNIQUE')) {
        throw new HttpError(409, `该分类下品种已存在: ${normalized.quoteCode}`);
      }
      throw error;
    }
  },

  deleteSymbol(symbolId) {
    const id = Number(symbolId);
    if (!Number.isFinite(id) || id <= 0) {
      throw new HttpError(400, 'symbolId 非法');
    }

    const existing = futuresRepository.getSymbolById(id);
    if (!existing) {
      throw new HttpError(404, `品种不存在: ${id}`);
    }

    futuresRepository.deleteSymbol(id);
    return existing;
  },

  /**
   * 获取期货监测看板数据
   * 根据分类配置或品种代码获取一批品种的实时行情和K线数据
   * 支持多种时间粒度，并自动处理数据源降级和本地缓存
   *
   * @param {Object} payload - 请求参数
   * @param {number} [payload.categoryId] - 分类ID（可选，不指定则返回所有分类下的品种）
   * @param {string|Array} [payload.quoteCode] - 品种代码（可选，用于筛选特定品种）
   * @param {string} [payload.timeframe='30s'] - 时间粒度
   * @param {number} [payload.limit] - K线数量限制
   * @returns {Promise<Object>} - 监测数据对象
   *   - timeframe: 时间粒度代码
   *   - timeframeLabel: 时间粒度标签
   *   - total: 总品种数
   *   - success: 成功获取数
   *   - failed: 失败数
   *   - categories: 分类列表
   *   - quoteCodes: 请求的品种代码
   *   - items: 各品种数据数组
   *   - fetchedAt: 获取时间
   */
  async getMonitor(payload = {}) {
    // 解析参数
    const categoryId = payload.categoryId ? Number(payload.categoryId) : null;
    const quoteCodes = parseMonitorQuoteCodes(payload.quoteCode);
    const quoteCodeSet = quoteCodes.length ? new Set(quoteCodes) : null;
    const timeframe = String(payload.timeframe || '30s');

    // 计算K线数量限制
    const hasExplicitLimit = payload.limit !== undefined && payload.limit !== null && payload.limit !== '';
    const defaultLimit = FUTURES_MONITOR_DEFAULT_LIMIT_MAP[timeframe]
      || (FUTURES_LONG_KLINE_KEYS.has(timeframe) ? 100 : 120);
    const parsedLimit = Number(hasExplicitLimit ? payload.limit : defaultLimit);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : defaultLimit;

    // 验证时间粒度
    if (!FUTURES_TIMEFRAME_MAP[timeframe]) {
      throw new HttpError(400, `不支持的时间粒度: ${timeframe}`);
    }

    // 获取分类列表
    const categories = this.listCategories();
    const scopedCategories = categoryId
      ? categories.filter((item) => item.id === categoryId)
      : categories;

    // 检查分类是否存在
    if (categoryId && !scopedCategories.length) {
      throw new HttpError(404, `分类不存在: ${categoryId}`);
    }

    // 筛选启用的分类
    const activeCategories = scopedCategories.filter((item) => item.isEnabled !== false);

    // 获取所有启用的品种
    let symbols = activeCategories.flatMap((item) => item.symbols || []).filter((item) => item.isActive !== false);

    // 如果指定了品种代码，进一步筛选
    if (quoteCodeSet) {
      symbols = symbols.filter((item) => {
        const key = normalizeMonitorQuoteCodeToken(item.quoteCode || `${item.market}.${item.code}`);
        if (quoteCodeSet.has(key)) return true;
        try {
          const normalized = normalizeQuoteCode(item.quoteCode || `${item.market}.${item.code}`);
          return quoteCodeSet.has(String(normalized.code || '').toUpperCase());
        } catch {
          return false;
        }
      });
    }

    // 无品种时返回空结果
    if (!symbols.length) {
      return {
        timeframe,
        timeframeLabel: FUTURES_TIMEFRAME_MAP[timeframe].label,
        total: 0,
        success: 0,
        failed: 0,
        categories: activeCategories,
        quoteCodes,
        items: [],
      };
    }

    // 创建分类映射，用于后续数据组装
    const categoryMap = new Map(activeCategories.map((item) => [item.id, item]));

    // 并行获取所有品种的数据
    const items = await Promise.all(symbols.map(async (symbol) => {
      const normalized = normalizeQuoteCode(symbol.quoteCode || `${symbol.market}.${symbol.code}`);
      const category = categoryMap.get(symbol.categoryId);

      // 并行发起行情和K线请求
      const quotePromise = fetchRealtimeQuote(normalized)
        .then((data) => ({ ok: true, data }))
        .catch((error) => ({ ok: false, error }));

      // 长周期K线优先使用本地缓存，避免远程API延迟
      const isLongTimeframe = FUTURES_LONG_KLINE_KEYS.has(timeframe);
      const rawCandlesResult = isLongTimeframe
        ? { ok: false, error: new Error('long-local-first') }
        : await fetchCandlesWithFallback(normalized, { timeframe, limit })
          .then((data) => ({ ok: true, data }))
          .catch((error) => ({ ok: false, error }));

      // 等待行情结果
      const quoteResult = await quotePromise;
      let candlesResult = rawCandlesResult;
      let finalQuote = quoteResult.ok ? quoteResult.data : null;

      // 收集警告和错误信息
      const warningList = [];
      const errorList = [];
      const quoteErrorText = quoteResult.ok ? '' : `实时行情失败: ${quoteResult.error?.message || '未知错误'}`;

      if (timeframe === '30s') {
        candlesResult = await fallbackThirtySecondsCandles(candlesResult, normalized, limit);
      }

      // 1分钟K线：合并本地缓存数据
      if (timeframe === '1m') {
        if (candlesResult.ok) {
          const mergedCandles = mergeAndPersistIntradayCandles({
            quoteCode: normalized.quoteCode,
            timeframe,
            limit,
            candles: candlesResult.data.candles || [],
            source: candlesResult.data.candleDataSource || null,
          });
          candlesResult = {
            ...candlesResult,
            data: {
              ...candlesResult.data,
              candles: mergedCandles,
              candleDataSource: candlesResult.data.candleDataSource === LOCAL_INTRADAY_DATA_SOURCE
                ? LOCAL_INTRADAY_DATA_SOURCE
                : `${candlesResult.data.candleDataSource || 'unknown'}+${LOCAL_INTRADAY_DATA_SOURCE}`,
            },
          };
        } else {
          const cachedCandles = loadIntradayCandlesFromStore({
            quoteCode: normalized.quoteCode,
            timeframe,
            limit,
          });
          if (cachedCandles.length) {
            candlesResult = {
              ok: true,
              data: {
                candles: cachedCandles,
                candleDataSource: LOCAL_INTRADAY_DATA_SOURCE,
                degraded: true,
                warning: `K线接口不可用，已回退本地缓存: ${rawCandlesResult.error?.message || '未知错误'}`,
              },
            };
          }
        }
      } else if (FUTURES_LONG_KLINE_KEYS.has(timeframe)) {
        let localCandles = loadLongCandlesFromStore({
          quoteCode: normalized.quoteCode,
          timeframe,
          limit,
        });
        const currentDerived = buildCurrentLongCandleFromMinuteStore({
          quoteCode: normalized.quoteCode,
          timeframe,
        });
        if (currentDerived) {
          localCandles = mergeAndPersistLongCandles({
            quoteCode: normalized.quoteCode,
            timeframe,
            limit,
            candles: [currentDerived],
            source: LOCAL_DERIVED_INTRADAY_SOURCE,
          });
        }

        const cacheComplete = isLongCacheComplete(localCandles, timeframe, limit);
        if (!cacheComplete) {
          triggerLongKlineBackgroundSync({
            normalized,
            timeframe,
            limit,
          });
        }

        if (localCandles.length) {
          candlesResult = {
            ok: true,
            data: {
              candles: localCandles,
              candleDataSource: LOCAL_INTRADAY_DATA_SOURCE,
              degraded: !cacheComplete,
              warning: cacheComplete ? null : 'K线优先展示本地缓存，后台正在补齐远程数据',
            },
          };
        } else {
          triggerLongKlineBackgroundSync({
            normalized,
            timeframe,
            limit,
          });
          candlesResult = {
            ok: false,
            error: new Error('本地暂无K线缓存，后台已启动补齐任务'),
          };
        }
      }

      if (!candlesResult.ok) {
        if (candlesResult.error?.message !== 'long-local-first') {
          logFuturesMonitorIssue({
            level: 'error',
            stage: 'candles-final-failed',
            symbol: normalized,
            timeframe,
            limit,
            error: candlesResult.error,
          });
        }
        errorList.push(`K线失败: ${candlesResult.error?.message || '未知错误'}`);
      } else if (candlesResult.data.warning) {
        warningList.push(candlesResult.data.warning);
      }

      if (!finalQuote && candlesResult.ok) {
        const fallbackQuote = buildQuoteFallbackFromCandles(normalized, candlesResult.data.candles || []);
        if (fallbackQuote) {
          finalQuote = fallbackQuote;
          if (quoteErrorText) {
            warningList.push(`实时行情不可用，已使用本地K线末值估算: ${quoteResult.error?.message || '未知错误'}`);
          }
        }
      }

      if (!finalQuote && quoteErrorText) {
        logFuturesMonitorIssue({
          level: 'error',
          stage: 'quote-final-failed',
          symbol: normalized,
          timeframe,
          limit,
          error: quoteResult.error,
        });
        errorList.push(quoteErrorText);
      } else if (!quoteResult.ok && finalQuote) {
        logFuturesMonitorIssue({
          level: 'warn',
          stage: 'quote-failed-fallback-used',
          symbol: normalized,
          timeframe,
          limit,
          error: quoteResult.error,
          extra: { quoteDataSource: finalQuote?.dataSource || null },
        });
      }

      return {
        id: symbol.id,
        categoryId: symbol.categoryId,
        categoryName: category?.name || '-',
        name: symbol.name,
        quoteCode: normalized.quoteCode,
        market: normalized.market,
        code: normalized.code,
        tradingHours: symbol.tradingHours || getOfficialFuturesTradingHours(normalized),
        timeframe,
        timeframeLabel: FUTURES_TIMEFRAME_MAP[timeframe].label,
        quote: finalQuote,
        candles: candlesResult.ok ? candlesResult.data.candles : [],
        candleDataSource: candlesResult.ok ? candlesResult.data.candleDataSource : null,
        warning: warningList.length ? warningList.join(' | ') : null,
        error: errorList.length ? errorList.join(' | ') : null,
      };
    }));

    const success = items.filter((item) => !item.error).length;
    const failed = items.length - success;

    return {
      timeframe,
      timeframeLabel: FUTURES_TIMEFRAME_MAP[timeframe].label,
      total: items.length,
      success,
      failed,
      categories: activeCategories,
      quoteCodes,
      items,
      fetchedAt: nowLocalDateTime(),
      failOpen: true,
    };
  },
};

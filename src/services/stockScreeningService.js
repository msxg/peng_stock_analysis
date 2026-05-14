import { HttpError } from '../utils/httpError.js';
import { normalizeStockCode } from '../utils/stockCode.js';
import { stockScreeningRepository } from '../repositories/stockScreeningRepository.js';
import { stockMonitorService } from './stockMonitorService.js';
import { bluechipPoolService } from './bluechipPoolService.js';
import { bluechipPoolRepository } from '../repositories/bluechipPoolRepository.js';

const SUPPORTED_MARKET = 'A';
const DEFAULT_SUB_MARKETS = ['SH', 'SZ', 'BJ'];
const DEFAULT_BOARD_SEGMENTS = ['MAIN', 'GEM', 'STAR'];
const OPERATORS = new Set(['>', '>=', '<', '<=', '==', '!=']);
const FIELD_NAMES = new Set(['open', 'high', 'low', 'close', 'preClose', 'change', 'pctChg', 'vol', 'amount']);
const INDICATOR_NAMES = new Set(['ma5', 'ma10', 'ma20', 'ma60']);
const METRIC_NAMES = new Set(['pctChgN', 'rangeAvgClose', 'rangeMaxClose', 'rangeMinClose', 'rangePctChg']);
const SORT_ORDERS = new Set(['asc', 'desc']);

function isDateText(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function toNumberOrNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && String(value).trim() === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toPositiveInt(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.floor(num));
}

function toNonNegativeInt(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.floor(num));
}

function toBool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

function sanitizeList(values = [], defaults = []) {
  const source = Array.isArray(values) ? values : [];
  const cleaned = Array.from(new Set(source.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean)));
  if (cleaned.length) return cleaned;
  return Array.from(new Set((Array.isArray(defaults) ? defaults : []).map((item) => String(item || '').trim().toUpperCase()).filter(Boolean)));
}

function normalizeBoardSegmentByCode({ subMarket = '', code = '' } = {}) {
  const market = String(subMarket || '').trim().toUpperCase();
  const normalizedCode = String(code || '').trim();

  if (market === 'SZ' && (/^300\d{3}$/.test(normalizedCode) || /^301\d{3}$/.test(normalizedCode))) {
    return 'GEM';
  }

  if (market === 'SH' && /^688\d{3}$/.test(normalizedCode)) {
    return 'STAR';
  }

  return 'MAIN';
}

function parseListingDate(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return null;

  if (/^\d{8}$/.test(raw)) {
    const y = raw.slice(0, 4);
    const m = raw.slice(4, 6);
    const d = raw.slice(6, 8);
    const parsed = new Date(`${y}-${m}-${d}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(`${raw}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function diffDays(fromDate, toDate) {
  if (!(fromDate instanceof Date) || Number.isNaN(fromDate.getTime())) return null;
  if (!(toDate instanceof Date) || Number.isNaN(toDate.getTime())) return null;
  const a = Date.UTC(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const b = Date.UTC(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
  return Math.max(0, Math.floor((b - a) / (24 * 60 * 60 * 1000)));
}

function shiftDateText(baseDay = '', diffDaysCount = 0) {
  if (!isDateText(baseDay)) return '';
  const d = new Date(`${baseDay}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + Number(diffDaysCount || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatRuleExpression(rule = {}) {
  const left = describeOperand(rule.left);
  const right = describeOperand(rule.right);
  return `${left} ${rule.operator} ${right}`;
}

function describeOperand(operand = {}) {
  const type = String(operand?.type || '').trim();
  if (type === 'field') {
    return String(operand.name || 'field');
  }
  if (type === 'indicator') {
    return String(operand.name || 'indicator');
  }
  if (type === 'metric') {
    const metricName = String(operand.name || 'metric');
    if (metricName === 'pctChgN') {
      const days = toPositiveInt(operand?.args?.days, 20);
      return `pctChgN(${days})`;
    }
    return metricName;
  }
  if (type === 'const') {
    return String(operand.value ?? '--');
  }
  return '--';
}

function normalizeOperand(input = {}) {
  const type = String(input?.type || '').trim();
  if (!['field', 'indicator', 'metric', 'const'].includes(type)) {
    throw new HttpError(400, `不支持的 operand.type: ${type || '--'}`);
  }

  if (type === 'field') {
    const name = String(input?.name || '').trim();
    if (!FIELD_NAMES.has(name)) {
      throw new HttpError(400, `不支持的字段: ${name || '--'}`);
    }
    return { type, name };
  }

  if (type === 'indicator') {
    const name = String(input?.name || '').trim();
    if (!INDICATOR_NAMES.has(name)) {
      throw new HttpError(400, `不支持的指标: ${name || '--'}`);
    }
    return { type, name };
  }

  if (type === 'metric') {
    const name = String(input?.name || '').trim();
    if (!METRIC_NAMES.has(name)) {
      throw new HttpError(400, `不支持的度量: ${name || '--'}`);
    }

    const args = {};
    if (name === 'pctChgN') {
      args.days = toPositiveInt(input?.args?.days, 20);
    }

    return {
      type,
      name,
      args,
    };
  }

  const numeric = toNumberOrNull(input?.value);
  if (numeric === null) {
    throw new HttpError(400, 'const 类型的 value 必须为数字');
  }
  return {
    type,
    value: numeric,
  };
}

function normalizeTechnicalRules(rules = []) {
  const source = Array.isArray(rules) ? rules : [];
  return source.map((item, index) => {
    const operator = String(item?.operator || '').trim();
    if (!OPERATORS.has(operator)) {
      throw new HttpError(400, `第 ${index + 1} 条 technicalRule 的 operator 非法`);
    }

    const left = normalizeOperand(item?.left || {});
    const right = normalizeOperand(item?.right || {});

    return {
      left,
      operator,
      right,
      expression: formatRuleExpression({ left, operator, right }),
    };
  });
}

function compareValues(left, operator, right) {
  switch (operator) {
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    default:
      return false;
  }
}

function calcSimpleMa(bars = [], endIndex = -1, days = 5) {
  const count = toPositiveInt(days, 5);
  if (!Array.isArray(bars) || endIndex < 0 || endIndex >= bars.length) return null;
  if (endIndex - count + 1 < 0) return null;

  let sum = 0;
  for (let i = endIndex - count + 1; i <= endIndex; i += 1) {
    const close = toNumberOrNull(bars[i]?.close);
    if (close === null) return null;
    sum += close;
  }
  return Number((sum / count).toFixed(6));
}

function calcPctChgN(bars = [], endIndex = -1, days = 20) {
  const n = toPositiveInt(days, 20);
  if (!Array.isArray(bars) || endIndex < 0 || endIndex >= bars.length) return null;
  const baseIndex = endIndex - n;
  if (baseIndex < 0) return null;

  const endClose = toNumberOrNull(bars[endIndex]?.close);
  const baseClose = toNumberOrNull(bars[baseIndex]?.close);
  if (endClose === null || baseClose === null || baseClose === 0) return null;

  return Number((((endClose - baseClose) / baseClose) * 100).toFixed(6));
}

function calcRangeStats(rangeBars = []) {
  const closes = (Array.isArray(rangeBars) ? rangeBars : [])
    .map((item) => toNumberOrNull(item?.close))
    .filter((item) => item !== null);

  if (!closes.length) {
    return {
      rangeAvgClose: null,
      rangeMaxClose: null,
      rangeMinClose: null,
      rangePctChg: null,
    };
  }

  const sum = closes.reduce((acc, cur) => acc + cur, 0);
  const firstClose = closes[0];
  const lastClose = closes[closes.length - 1];
  const rangePctChg = firstClose > 0
    ? Number((((lastClose - firstClose) / firstClose) * 100).toFixed(6))
    : null;
  return {
    rangeAvgClose: Number((sum / closes.length).toFixed(6)),
    rangeMaxClose: Number(Math.max(...closes).toFixed(6)),
    rangeMinClose: Number(Math.min(...closes).toFixed(6)),
    rangePctChg,
  };
}

function resolveOperandValue(operand = {}, ctx = {}) {
  const latest = ctx?.latestBar || null;
  const bars = Array.isArray(ctx?.bars) ? ctx.bars : [];
  const endIndex = Number.isFinite(ctx?.endIndex) ? ctx.endIndex : bars.length - 1;

  if (operand.type === 'const') {
    return toNumberOrNull(operand.value);
  }

  if (operand.type === 'field') {
    return toNumberOrNull(latest?.[operand.name]);
  }

  if (operand.type === 'indicator') {
    if (operand.name === 'ma5') return calcSimpleMa(bars, endIndex, 5);
    if (operand.name === 'ma10') return calcSimpleMa(bars, endIndex, 10);
    if (operand.name === 'ma20') return calcSimpleMa(bars, endIndex, 20);
    if (operand.name === 'ma60') return calcSimpleMa(bars, endIndex, 60);
    return null;
  }

  if (operand.type === 'metric') {
    if (operand.name === 'pctChgN') {
      return calcPctChgN(bars, endIndex, operand?.args?.days || 20);
    }
    if (operand.name === 'rangeAvgClose') return toNumberOrNull(ctx?.rangeStats?.rangeAvgClose);
    if (operand.name === 'rangeMaxClose') return toNumberOrNull(ctx?.rangeStats?.rangeMaxClose);
    if (operand.name === 'rangeMinClose') return toNumberOrNull(ctx?.rangeStats?.rangeMinClose);
    if (operand.name === 'rangePctChg') return toNumberOrNull(ctx?.rangeStats?.rangePctChg);
    return null;
  }

  return null;
}

function evaluateRule(rule, ctx) {
  const leftValue = resolveOperandValue(rule.left, ctx);
  const rightValue = resolveOperandValue(rule.right, ctx);
  if (leftValue === null || rightValue === null) {
    return {
      matched: false,
      missingOperand: true,
      expression: rule.expression,
      leftValue,
      rightValue,
    };
  }

  return {
    matched: compareValues(leftValue, rule.operator, rightValue),
    missingOperand: false,
    expression: rule.expression,
    leftValue,
    rightValue,
  };
}

function normalizeQueryPayload(payload = {}) {
  const market = String(payload?.market || SUPPORTED_MARKET).trim().toUpperCase() || SUPPORTED_MARKET;
  if (market !== SUPPORTED_MARKET) {
    throw new HttpError(400, `仅支持 A股: market=${market}`);
  }

  const subMarkets = sanitizeList(payload?.subMarkets, DEFAULT_SUB_MARKETS);
  const invalidSub = subMarkets.filter((item) => !DEFAULT_SUB_MARKETS.includes(item));
  if (invalidSub.length) {
    throw new HttpError(400, `subMarkets 不支持: ${invalidSub.join(',')}`);
  }

  const boardSegments = sanitizeList(payload?.boardSegments, DEFAULT_BOARD_SEGMENTS);
  const invalidBoards = boardSegments.filter((item) => !DEFAULT_BOARD_SEGMENTS.includes(item));
  if (invalidBoards.length) {
    throw new HttpError(400, `boardSegments 不支持: ${invalidBoards.join(',')}`);
  }

  const startDate = String(payload?.dateRange?.startDate || '').trim();
  const endDate = String(payload?.dateRange?.endDate || '').trim();
  if (!isDateText(startDate) || !isDateText(endDate)) {
    throw new HttpError(400, 'dateRange.startDate/endDate 必须为 YYYY-MM-DD');
  }
  if (startDate > endDate) {
    throw new HttpError(400, 'dateRange.startDate 不能大于 endDate');
  }

  const daySpan = diffDays(new Date(`${startDate}T00:00:00`), new Date(`${endDate}T00:00:00`));
  if (daySpan !== null && daySpan > 730) {
    throw new HttpError(400, '日期跨度过大，V1 最多支持 730 天');
  }

  const fundamentals = payload?.fundamentals || {};
  const technicalRules = normalizeTechnicalRules(payload?.technicalRules || []);

  const sortField = String(payload?.sort?.field || 'pctChgN').trim();
  const sortOrder = String(payload?.sort?.order || 'desc').trim().toLowerCase();

  return {
    market,
    subMarkets,
    boardSegments,
    dateRange: {
      startDate,
      endDate,
    },
    fundamentals: {
      totalMarketCapMin: toNumberOrNull(fundamentals.totalMarketCapMin),
      totalMarketCapMax: toNumberOrNull(fundamentals.totalMarketCapMax),
      listingDaysMin: toNonNegativeInt(fundamentals.listingDaysMin, 0),
    },
    technicalRules,
    sort: {
      field: sortField,
      order: SORT_ORDERS.has(sortOrder) ? sortOrder : 'desc',
    },
    page: toPositiveInt(payload?.page, 1),
    limit: Math.min(200, toPositiveInt(payload?.limit, 50)),
    failOpen: toBool(payload?.failOpen, true),
  };
}

function normalizeCodesInput(codes = []) {
  const source = Array.isArray(codes) ? codes : [];
  const result = [];
  source.forEach((item) => {
    const raw = String(item || '').trim().toUpperCase();
    if (!raw) return;
    const normalized = normalizeStockCode(raw);
    if (!normalized) return;
    if (/^(SH|SZ|BJ)\d{6}$/.test(normalized)) {
      result.push(normalized.slice(2));
      return;
    }
    if (/^\d{6}$/.test(normalized)) {
      result.push(normalized);
    }
  });
  return Array.from(new Set(result));
}

function normalizeActionPayload(payload = {}) {
  const codes = normalizeCodesInput(payload?.codes || []);
  if (!codes.length) {
    throw new HttpError(400, 'codes 不能为空');
  }
  if (codes.length > 2000) {
    throw new HttpError(400, 'codes 过多，单次最多 2000 条');
  }
  return codes;
}

function sortByField(items = [], field = 'pctChgN', order = 'desc') {
  const source = Array.isArray(items) ? [...items] : [];
  const factor = order === 'asc' ? 1 : -1;
  source.sort((a, b) => {
    const av = a?.sortValues?.[field];
    const bv = b?.sortValues?.[field];

    const aNum = toNumberOrNull(av);
    const bNum = toNumberOrNull(bv);
    if (aNum !== null || bNum !== null) {
      if (aNum === null) return 1;
      if (bNum === null) return -1;
      if (aNum === bNum) {
        return String(a.code || '').localeCompare(String(b.code || ''));
      }
      return (aNum - bNum) * factor;
    }

    const aText = String(av ?? '');
    const bText = String(bv ?? '');
    if (aText === bText) {
      return String(a.code || '').localeCompare(String(b.code || ''));
    }
    return aText.localeCompare(bText) * factor;
  });
  return source;
}

export const stockScreeningService = {
  query(payload = {}) {
    const normalized = normalizeQueryPayload(payload);
    const warnings = [];

    const maxLookbackFromRules = normalized.technicalRules.reduce((acc, rule) => {
      const candidates = [rule.left, rule.right]
        .filter((operand) => operand?.type === 'indicator' || operand?.type === 'metric')
        .map((operand) => {
          if (operand.type === 'indicator') {
            if (operand.name === 'ma5') return 5;
            if (operand.name === 'ma10') return 10;
            if (operand.name === 'ma20') return 20;
            if (operand.name === 'ma60') return 60;
            return 0;
          }
          if (operand.name === 'pctChgN') return toPositiveInt(operand?.args?.days, 20);
          return 0;
        });
      const maxRule = candidates.length ? Math.max(...candidates) : 0;
      return Math.max(acc, maxRule);
    }, 0);

    const lookbackDays = Math.max(120, maxLookbackFromRules * 4);
    const lookbackStartDay = shiftDateText(normalized.dateRange.startDate, -lookbackDays);

    const asOfDate = new Date(`${normalized.dateRange.endDate}T00:00:00`);

    let candidates = stockScreeningRepository.listCandidateBasics({
      subMarkets: normalized.subMarkets,
      totalMarketCapMin: normalized.fundamentals.totalMarketCapMin,
      totalMarketCapMax: normalized.fundamentals.totalMarketCapMax,
      limit: 8000,
    });

    candidates = candidates.filter((item) => normalized.boardSegments.includes(normalizeBoardSegmentByCode(item)));

    if (normalized.fundamentals.listingDaysMin > 0) {
      candidates = candidates.filter((item) => {
        const listingDate = parseListingDate(item?.listingDate);
        const days = diffDays(listingDate, asOfDate);
        if (days === null) return false;
        return days >= normalized.fundamentals.listingDaysMin;
      });
    }

    if (candidates.length > 5000) {
      warnings.push(`候选样本过大(${candidates.length})，已按代码截断至 5000 只`);
      candidates = candidates.slice(0, 5000);
    }

    const codes = candidates.map((item) => String(item.code || '').trim()).filter(Boolean);
    const bars = stockScreeningRepository.listEodBarsByCodesAndRange({
      codes,
      startDay: lookbackStartDay || normalized.dateRange.startDate,
      endDay: normalized.dateRange.endDate,
      timeframe: '1d',
    });

    const barsByCode = new Map();
    bars.forEach((bar) => {
      const code = String(bar.stockCode || '').trim().toUpperCase();
      if (!code) return;
      if (!barsByCode.has(code)) barsByCode.set(code, []);
      barsByCode.get(code).push(bar);
    });

    let insufficientDataCount = 0;
    const resultItems = [];

    candidates.forEach((candidate) => {
      const code = String(candidate.code || '').trim().toUpperCase();
      const allBars = barsByCode.get(code) || [];
      if (!allBars.length) {
        insufficientDataCount += 1;
        return;
      }

      const rangeBars = allBars.filter((bar) => {
        const day = String(bar.tradeDay || '').trim();
        return day >= normalized.dateRange.startDate && day <= normalized.dateRange.endDate;
      });
      if (!rangeBars.length) {
        insufficientDataCount += 1;
        return;
      }

      const latestBar = rangeBars[rangeBars.length - 1];
      const endIndex = allBars.findIndex((bar) => bar.tradeDay === latestBar.tradeDay);
      if (endIndex < 0) {
        insufficientDataCount += 1;
        return;
      }

      const rangeStats = calcRangeStats(rangeBars);
      const ctx = {
        bars: allBars,
        rangeBars,
        latestBar,
        endIndex,
        rangeStats,
      };

      const evaluations = normalized.technicalRules.map((rule) => evaluateRule(rule, ctx));
      const hasMissingOperand = evaluations.some((item) => item.missingOperand);
      const allMatched = evaluations.every((item) => item.matched);

      if (hasMissingOperand) {
        insufficientDataCount += 1;
      }

      if (!allMatched) {
        return;
      }

      const ma5 = calcSimpleMa(allBars, endIndex, 5);
      const ma10 = calcSimpleMa(allBars, endIndex, 10);
      const ma20 = calcSimpleMa(allBars, endIndex, 20);
      const ma60 = calcSimpleMa(allBars, endIndex, 60);
      const pctChg20 = calcPctChgN(allBars, endIndex, 20);

      resultItems.push({
        code,
        name: candidate.name,
        market: SUPPORTED_MARKET,
        subMarket: String(candidate.subMarket || '').toUpperCase() || '--',
        boardSegment: normalizeBoardSegmentByCode(candidate),
        tradeDay: latestBar.tradeDay,
        close: toNumberOrNull(latestBar.close),
        totalMarketCap: toNumberOrNull(candidate.totalMarketCap),
        listingDate: candidate.listingDate,
        ma5,
        ma10,
        ma20,
        ma60,
        pctChgN20: pctChg20,
        rangeAvgClose: rangeStats.rangeAvgClose,
        rangeMaxClose: rangeStats.rangeMaxClose,
        rangeMinClose: rangeStats.rangeMinClose,
        rangePctChg: rangeStats.rangePctChg,
        hitRules: evaluations.map((item) => item.expression),
        sortValues: {
          code,
          name: candidate.name,
          close: toNumberOrNull(latestBar.close),
          pctChgN: pctChg20,
          ma5,
          ma10,
          ma20,
          ma60,
          rangeAvgClose: rangeStats.rangeAvgClose,
          rangeMaxClose: rangeStats.rangeMaxClose,
          rangeMinClose: rangeStats.rangeMinClose,
          rangePctChg: rangeStats.rangePctChg,
          totalMarketCap: toNumberOrNull(candidate.totalMarketCap),
        },
      });
    });

    if (insufficientDataCount > 0) {
      warnings.push(`有 ${insufficientDataCount} 只股票因数据不足被跳过`);
    }

    const sorted = sortByField(resultItems, normalized.sort.field, normalized.sort.order);
    const total = sorted.length;
    const start = (normalized.page - 1) * normalized.limit;
    const items = sorted.slice(start, start + normalized.limit);

    const dataAsOf = stockScreeningRepository.getLatestTradeDayInRange({
      startDay: normalized.dateRange.startDate,
      endDay: normalized.dateRange.endDate,
      timeframe: '1d',
    }) || normalized.dateRange.endDate;

    return {
      page: normalized.page,
      limit: normalized.limit,
      total,
      dataAsOf,
      items,
      warning: warnings.length ? warnings.join(' | ') : null,
      failOpen: normalized.failOpen,
      applied: {
        market: normalized.market,
        subMarkets: normalized.subMarkets,
        boardSegments: normalized.boardSegments,
        dateRange: normalized.dateRange,
        fundamentals: normalized.fundamentals,
        technicalRules: normalized.technicalRules.map((item) => item.expression),
        sort: normalized.sort,
      },
    };
  },

  async addToMonitor(payload = {}) {
    const categoryId = Number(payload?.categoryId);
    if (!Number.isFinite(categoryId) || categoryId <= 0) {
      throw new HttpError(400, 'categoryId 非法');
    }

    const codes = normalizeActionPayload(payload);
    const details = [];
    let success = 0;
    let skipped = 0;
    let failed = 0;

    for (const code of codes) {
      try {
        await stockMonitorService.createSymbol({
          categoryId,
          stockCode: code,
          symbolType: 'stock',
          market: 'A',
        });
        success += 1;
        details.push({ code, status: 'success' });
      } catch (error) {
        const message = String(error?.message || 'unknown_error');
        if (error?.status === 409 || message.includes('已存在')) {
          skipped += 1;
          details.push({ code, status: 'skipped', reason: 'duplicate' });
          continue;
        }

        failed += 1;
        details.push({ code, status: 'failed', reason: message });
      }
    }

    return {
      success,
      skipped,
      failed,
      details,
    };
  },

  addToBluechipPool(payload = {}) {
    const poolId = Number(payload?.poolId);
    const poolCode = String(payload?.poolCode || '').trim().toUpperCase();

    let targetPoolId = null;
    if (Number.isFinite(poolId) && poolId > 0) {
      targetPoolId = poolId;
    } else if (poolCode) {
      const pool = bluechipPoolRepository.getPoolByCode(poolCode);
      if (!pool) {
        throw new HttpError(404, `标的池不存在: ${poolCode}`);
      }
      targetPoolId = Number(pool.id);
    }

    if (!Number.isFinite(targetPoolId) || targetPoolId <= 0) {
      throw new HttpError(400, 'poolId/poolCode 至少提供一个');
    }

    const codes = normalizeActionPayload(payload);
    const details = [];
    let success = 0;
    let skipped = 0;
    let failed = 0;

    for (const code of codes) {
      try {
        bluechipPoolService.createPoolSymbol(targetPoolId, {
          stockCode: code,
        });
        success += 1;
        details.push({ code, status: 'success' });
      } catch (error) {
        const message = String(error?.message || 'unknown_error');
        if (error?.status === 409 || message.includes('已存在')) {
          skipped += 1;
          details.push({ code, status: 'skipped', reason: 'duplicate' });
          continue;
        }
        failed += 1;
        details.push({ code, status: 'failed', reason: message });
      }
    }

    return {
      success,
      skipped,
      failed,
      details,
    };
  },
};

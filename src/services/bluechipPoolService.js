import { HttpError } from '../utils/httpError.js';
import { normalizeStockCode, inferMarket } from '../utils/stockCode.js';
import { stockBasicsRepository } from '../repositories/stockBasicsRepository.js';
import { bluechipPoolRepository } from '../repositories/bluechipPoolRepository.js';

function toBool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function normalizePoolCode(code = '') {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '_');
}

function assertPoolCode(code = '') {
  const normalized = normalizePoolCode(code);
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(normalized)) {
    throw new HttpError(400, '标的池编码仅支持大写字母/数字/下划线，且长度 2-64');
  }
  return normalized;
}

function nowCompact() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function randomSuffix(size = 4) {
  return Math.random().toString(36).slice(2, 2 + size).toUpperCase().padEnd(size, 'X');
}

function generatePoolCode() {
  return assertPoolCode(`POOL_${nowCompact()}_${randomSuffix(4)}`);
}

function generateUniquePoolCode() {
  for (let i = 0; i < 20; i += 1) {
    const code = generatePoolCode();
    if (!bluechipPoolRepository.getPoolByCode(code)) {
      return code;
    }
  }
  return assertPoolCode(`POOL_${Date.now()}_${randomSuffix(6)}`);
}

function normalizePoolStockCode(code = '') {
  const normalized = normalizeStockCode(code);
  const market = inferMarket(normalized);
  if (/^\d{6}$/.test(normalized)) return normalized;
  if (/^(SH|SZ)\d{6}$/.test(normalized)) return normalized;
  if (market === 'CN_SH' || market === 'CN_SZ') return normalized;
  throw new HttpError(400, `仅支持A股代码: ${code}`);
}

function resolveLocalStockName(stockCode = '') {
  const normalized = normalizeStockCode(stockCode);
  const core = normalized.replace(/^(SH|SZ)/, '');
  const local = stockBasicsRepository.findByCode(core)?.[0] || null;
  return String(local?.name || '').trim();
}

function mapPoolWithSymbols(pool, symbols = []) {
  return {
    ...pool,
    symbols,
    count: symbols.filter((item) => item.isActive !== false).length,
  };
}

export const bluechipPoolService = {
  listPools({ onlyEnabled = false } = {}) {
    const pools = bluechipPoolRepository.listPools({ onlyEnabled });
    return pools.map((pool) => {
      const symbols = bluechipPoolRepository.listSymbols(pool.id, { onlyActive: false });
      return mapPoolWithSymbols(pool, symbols);
    });
  },

  listPoolSummaries({ onlyEnabled = true } = {}) {
    return this.listPools({ onlyEnabled }).map((pool) => ({
      id: pool.id,
      code: pool.code,
      name: pool.name,
      description: pool.description || '',
      count: pool.count,
      isEnabled: pool.isEnabled !== false,
      sortOrder: pool.sortOrder,
    }));
  },

  createPool(payload = {}) {
    const name = String(payload.name || '').trim();
    if (!name) throw new HttpError(400, '标的池名称不能为空');
    const code = generateUniquePoolCode();

    try {
      return bluechipPoolRepository.createPool({
        code,
        name,
        description: String(payload.description || '').trim(),
        sortOrder: Number(payload.sortOrder || 100),
        isEnabled: toBool(payload.isEnabled, true),
      });
    } catch (error) {
      if (String(error?.message || '').includes('UNIQUE')) {
        throw new HttpError(409, `标的池编码或名称重复: ${code}`);
      }
      throw error;
    }
  },

  updatePool(poolId, payload = {}) {
    const id = Number(poolId);
    if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, 'poolId 非法');
    const existing = bluechipPoolRepository.getPoolById(id);
    if (!existing) throw new HttpError(404, `标的池不存在: ${id}`);

    const nextName = String(Object.prototype.hasOwnProperty.call(payload, 'name') ? payload.name : existing.name).trim();
    if (!nextName) throw new HttpError(400, '标的池名称不能为空');

    try {
      return bluechipPoolRepository.updatePool(id, {
        code: existing.code,
        name: nextName,
        description: Object.prototype.hasOwnProperty.call(payload, 'description') ? payload.description : existing.description,
        sortOrder: Object.prototype.hasOwnProperty.call(payload, 'sortOrder') ? payload.sortOrder : existing.sortOrder,
        isEnabled: Object.prototype.hasOwnProperty.call(payload, 'isEnabled')
          ? payload.isEnabled
          : existing.isEnabled,
      });
    } catch (error) {
      if (String(error?.message || '').includes('UNIQUE')) {
        throw new HttpError(409, `标的池编码或名称重复: ${existing.code}`);
      }
      throw error;
    }
  },

  deletePool(poolId) {
    const id = Number(poolId);
    if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, 'poolId 非法');
    const existing = bluechipPoolRepository.getPoolById(id);
    if (!existing) throw new HttpError(404, `标的池不存在: ${id}`);
    bluechipPoolRepository.deletePool(id);
    return existing;
  },

  createPoolSymbol(poolId, payload = {}) {
    const id = Number(poolId);
    if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, 'poolId 非法');
    const pool = bluechipPoolRepository.getPoolById(id);
    if (!pool) throw new HttpError(404, `标的池不存在: ${id}`);

    const stockCode = normalizePoolStockCode(payload.stockCode || payload.code || '');
    const stockName = String(payload.stockName || payload.name || '').trim() || resolveLocalStockName(stockCode) || stockCode;

    try {
      return bluechipPoolRepository.createSymbol({
        poolId: id,
        stockCode,
        stockName,
        sortOrder: Number(payload.sortOrder || 100),
        isActive: toBool(payload.isActive, true),
      });
    } catch (error) {
      if (String(error?.message || '').includes('UNIQUE')) {
        throw new HttpError(409, `该标的池下代码已存在: ${stockCode}`);
      }
      throw error;
    }
  },

  updatePoolSymbol(poolId, symbolId, payload = {}) {
    const pid = Number(poolId);
    const sid = Number(symbolId);
    if (!Number.isFinite(pid) || pid <= 0) throw new HttpError(400, 'poolId 非法');
    if (!Number.isFinite(sid) || sid <= 0) throw new HttpError(400, 'symbolId 非法');
    const pool = bluechipPoolRepository.getPoolById(pid);
    if (!pool) throw new HttpError(404, `标的池不存在: ${pid}`);
    const existing = bluechipPoolRepository.getSymbolById(sid);
    if (!existing || existing.poolId !== pid) throw new HttpError(404, `标的不存在: ${sid}`);

    const stockCode = normalizePoolStockCode(
      Object.prototype.hasOwnProperty.call(payload, 'stockCode') || Object.prototype.hasOwnProperty.call(payload, 'code')
        ? (payload.stockCode || payload.code)
        : existing.stockCode,
    );

    const stockName = String(
      Object.prototype.hasOwnProperty.call(payload, 'stockName') || Object.prototype.hasOwnProperty.call(payload, 'name')
        ? (payload.stockName || payload.name)
        : existing.stockName,
    ).trim() || resolveLocalStockName(stockCode) || stockCode;

    try {
      return bluechipPoolRepository.updateSymbol(sid, {
        stockCode,
        stockName,
        sortOrder: Object.prototype.hasOwnProperty.call(payload, 'sortOrder') ? payload.sortOrder : existing.sortOrder,
        isActive: Object.prototype.hasOwnProperty.call(payload, 'isActive') ? payload.isActive : existing.isActive,
      });
    } catch (error) {
      if (String(error?.message || '').includes('UNIQUE')) {
        throw new HttpError(409, `该标的池下代码已存在: ${stockCode}`);
      }
      throw error;
    }
  },

  deletePoolSymbol(poolId, symbolId) {
    const pid = Number(poolId);
    const sid = Number(symbolId);
    if (!Number.isFinite(pid) || pid <= 0) throw new HttpError(400, 'poolId 非法');
    if (!Number.isFinite(sid) || sid <= 0) throw new HttpError(400, 'symbolId 非法');
    const existing = bluechipPoolRepository.getSymbolById(sid);
    if (!existing || existing.poolId !== pid) throw new HttpError(404, `标的不存在: ${sid}`);
    bluechipPoolRepository.deleteSymbol(sid);
    return existing;
  },

  resolvePoolMembers(poolCode) {
    const normalizedCode = normalizePoolCode(poolCode);
    const pool = bluechipPoolRepository.getPoolByCode(normalizedCode);
    if (!pool || pool.isEnabled === false) {
      throw new HttpError(400, `未识别的标的池: ${normalizedCode || '--'}`);
    }
    const symbols = bluechipPoolRepository.listSymbols(pool.id, { onlyActive: true });
    const codes = Array.from(new Set(symbols.map((item) => normalizePoolStockCode(item.stockCode)).filter(Boolean)));
    const codeNameMap = {};
    symbols.forEach((item) => {
      const normalizedCode = normalizePoolStockCode(item.stockCode);
      if (!normalizedCode) return;
      const name = String(item.stockName || '').trim();
      if (!name) return;
      if (!codeNameMap[normalizedCode]) {
        codeNameMap[normalizedCode] = name;
      }
    });
    return {
      poolId: pool.id,
      poolCode: pool.code,
      poolName: pool.name,
      codes,
      codeNameMap,
      count: codes.length,
    };
  },
};

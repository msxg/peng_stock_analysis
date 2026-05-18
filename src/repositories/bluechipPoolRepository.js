import { getDb } from '../db/database.js';

function mapPool(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    isEnabled: row.is_enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSymbol(row) {
  if (!row) return null;
  return {
    id: row.id,
    poolId: row.pool_id,
    stockCode: row.stock_code,
    stockName: row.stock_name,
    sortOrder: row.sort_order,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const bluechipPoolRepository = {
  listPools({ onlyEnabled = false } = {}) {
    const db = getDb();
    const where = onlyEnabled ? 'WHERE is_enabled = 1' : '';
    return db.prepare(`
      SELECT *
      FROM bluechip_pools
      ${where}
      ORDER BY sort_order ASC, id ASC
    `).all().map(mapPool);
  },

  getPoolById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM bluechip_pools WHERE id = ?').get(id);
    return mapPool(row);
  },

  getPoolByCode(code) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM bluechip_pools WHERE code = ?').get(String(code || '').trim().toUpperCase());
    return mapPool(row);
  },

  createPool({ code, name, description = '', sortOrder = 100, isEnabled = true }) {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO bluechip_pools (code, name, description, sort_order, is_enabled, created_at, updated_at)
      VALUES (@code, @name, @description, @sortOrder, @isEnabled, datetime('now'), datetime('now'))
    `).run({
      code: String(code || '').trim().toUpperCase(),
      name: String(name || '').trim(),
      description: String(description || '').trim() || null,
      sortOrder: Number(sortOrder) || 100,
      isEnabled: isEnabled === false ? 0 : 1,
    });
    return this.getPoolById(result.lastInsertRowid);
  },

  updatePool(id, { code, name, description = '', sortOrder = 100, isEnabled = true }) {
    const db = getDb();
    db.prepare(`
      UPDATE bluechip_pools
      SET code = @code,
          name = @name,
          description = @description,
          sort_order = @sortOrder,
          is_enabled = @isEnabled,
          updated_at = datetime('now')
      WHERE id = @id
    `).run({
      id,
      code: String(code || '').trim().toUpperCase(),
      name: String(name || '').trim(),
      description: String(description || '').trim() || null,
      sortOrder: Number(sortOrder) || 100,
      isEnabled: isEnabled === false ? 0 : 1,
    });
    return this.getPoolById(id);
  },

  deletePool(id) {
    const db = getDb();
    return db.prepare('DELETE FROM bluechip_pools WHERE id = ?').run(id).changes;
  },

  listSymbols(poolId, { onlyActive = false } = {}) {
    const db = getDb();
    const where = ['pool_id = @poolId'];
    if (onlyActive) where.push('is_active = 1');
    return db.prepare(`
      SELECT *
      FROM bluechip_pool_symbols
      WHERE ${where.join(' AND ')}
      ORDER BY sort_order ASC, id ASC
    `).all({ poolId: Number(poolId) }).map(mapSymbol);
  },

  getSymbolById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM bluechip_pool_symbols WHERE id = ?').get(id);
    return mapSymbol(row);
  },

  createSymbol({ poolId, stockCode, stockName = '', sortOrder = 100, isActive = true }) {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO bluechip_pool_symbols (pool_id, stock_code, stock_name, sort_order, is_active, created_at, updated_at)
      VALUES (@poolId, @stockCode, @stockName, @sortOrder, @isActive, datetime('now'), datetime('now'))
    `).run({
      poolId: Number(poolId),
      stockCode: String(stockCode || '').trim().toUpperCase(),
      stockName: String(stockName || '').trim() || null,
      sortOrder: Number(sortOrder) || 100,
      isActive: isActive === false ? 0 : 1,
    });
    return this.getSymbolById(result.lastInsertRowid);
  },

  updateSymbol(id, { stockCode, stockName = '', sortOrder = 100, isActive = true }) {
    const db = getDb();
    db.prepare(`
      UPDATE bluechip_pool_symbols
      SET stock_code = @stockCode,
          stock_name = @stockName,
          sort_order = @sortOrder,
          is_active = @isActive,
          updated_at = datetime('now')
      WHERE id = @id
    `).run({
      id,
      stockCode: String(stockCode || '').trim().toUpperCase(),
      stockName: String(stockName || '').trim() || null,
      sortOrder: Number(sortOrder) || 100,
      isActive: isActive === false ? 0 : 1,
    });
    return this.getSymbolById(id);
  },

  deleteSymbol(id) {
    const db = getDb();
    return db.prepare('DELETE FROM bluechip_pool_symbols WHERE id = ?').run(id).changes;
  },

  clearSymbolsByPoolId(poolId) {
    const db = getDb();
    return db.prepare('DELETE FROM bluechip_pool_symbols WHERE pool_id = ?').run(Number(poolId)).changes;
  },
};

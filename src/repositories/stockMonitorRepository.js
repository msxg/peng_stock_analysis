import { getDb } from '../db/database.js';

function inferSymbolType(row) {
  const explicit = String(row?.symbol_type || '').trim().toLowerCase();
  if (explicit) return explicit;
  const market = String(row?.market || '').trim().toUpperCase();
  if (market.startsWith('FUTURES_')) return 'futures';
  return 'stock';
}

function mapCategory(row) {
  if (!row) return null;
  return {
    id: row.id,
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
  const symbolType = inferSymbolType(row);
  const symbolCode = String(row.symbol_code || '').trim();
  const quoteCode = String(row.quote_code || symbolCode).trim();
  const displayName = String(row.display_name || symbolCode).trim();

  return {
    id: row.id,
    categoryId: row.category_id,
    name: displayName,
    displayName,
    stockCode: symbolCode,
    symbolCode,
    quoteCode,
    symbolType,
    market: row.market,
    exchange: row.exchange || null,
    sortOrder: row.sort_order,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const stockMonitorRepository = {
  listCategories() {
    const db = getDb();
    return db.prepare(`
      SELECT *
      FROM monitor_categories
      ORDER BY sort_order ASC, id ASC
    `).all().map(mapCategory);
  },

  getCategoryById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM monitor_categories WHERE id = ?').get(id);
    return mapCategory(row);
  },

  createCategory({ name, description, sortOrder = 100, isEnabled = true }) {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO monitor_categories (name, description, sort_order, is_enabled, created_at, updated_at)
      VALUES (@name, @description, @sortOrder, @isEnabled, datetime('now'), datetime('now'))
    `).run({
      name,
      description: description || null,
      sortOrder,
      isEnabled: isEnabled === false ? 0 : 1,
    });
    return this.getCategoryById(result.lastInsertRowid);
  },

  updateCategory(id, { name, description, sortOrder = 100, isEnabled = true }) {
    const db = getDb();
    db.prepare(`
      UPDATE monitor_categories
      SET name = @name,
          description = @description,
          sort_order = @sortOrder,
          is_enabled = @isEnabled,
          updated_at = datetime('now')
      WHERE id = @id
    `).run({
      id,
      name,
      description: description || null,
      sortOrder,
      isEnabled: isEnabled === false ? 0 : 1,
    });
    return this.getCategoryById(id);
  },

  deleteCategory(id) {
    const db = getDb();
    return db.prepare('DELETE FROM monitor_categories WHERE id = ?').run(id).changes;
  },

  reorderCategories(categoryIds = []) {
    const ids = Array.isArray(categoryIds)
      ? categoryIds
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0)
      : [];
    if (!ids.length) {
      return this.listCategories();
    }

    const db = getDb();
    const stmt = db.prepare(`
      UPDATE monitor_categories
      SET sort_order = @sortOrder,
          updated_at = datetime('now')
      WHERE id = @id
    `);
    const tx = db.transaction((orderedIds) => {
      orderedIds.forEach((item, index) => {
        stmt.run({
          id: item,
          sortOrder: (index + 1) * 10,
        });
      });
    });
    tx(ids);
    return this.listCategories();
  },

  listSymbols({ categoryId, onlyActive = true, symbolType } = {}) {
    const db = getDb();
    const where = ['1 = 1'];
    const params = {};

    if (Number.isFinite(Number(categoryId)) && Number(categoryId) > 0) {
      where.push('category_id = @categoryId');
      params.categoryId = Number(categoryId);
    }

    if (onlyActive) {
      where.push('is_active = 1');
    }

    const normalizedType = String(symbolType || '').trim().toLowerCase();
    if (normalizedType) {
      where.push('LOWER(symbol_type) = @symbolType');
      params.symbolType = normalizedType;
    }

    return db.prepare(`
      SELECT *
      FROM monitor_symbols
      WHERE ${where.join(' AND ')}
      ORDER BY sort_order ASC, id ASC
    `).all(params).map(mapSymbol);
  },

  createSymbol(item) {
    const db = getDb();
    const symbolType = String(item.symbolType || 'stock').trim().toLowerCase() || 'stock';
    const symbolCode = String(item.stockCode || item.symbolCode || item.code || item.quoteCode || '').trim().toUpperCase();
    const quoteCode = String(item.quoteCode || symbolCode).trim().toUpperCase();
    const displayName = String(item.name || item.displayName || symbolCode).trim() || symbolCode;
    const market = String(item.market || 'A').trim().toUpperCase() || 'A';

    const result = db.prepare(`
      INSERT INTO monitor_symbols (
        category_id, symbol_code, quote_code, symbol_type, market, exchange, display_name, sort_order, is_active, created_at, updated_at
      )
      VALUES (
        @categoryId, @symbolCode, @quoteCode, @symbolType, @market, @exchange, @displayName, @sortOrder, @isActive, datetime('now'), datetime('now')
      )
    `).run({
      categoryId: item.categoryId,
      symbolCode,
      quoteCode: quoteCode || null,
      symbolType,
      market,
      exchange: item.exchange || null,
      displayName,
      sortOrder: item.sortOrder ?? 100,
      isActive: item.isActive === false ? 0 : 1,
    });

    return this.getSymbolById(result.lastInsertRowid);
  },

  getSymbolById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM monitor_symbols WHERE id = ?').get(id);
    return mapSymbol(row);
  },

  deleteSymbol(id) {
    const db = getDb();
    return db.prepare('DELETE FROM monitor_symbols WHERE id = ?').run(id).changes;
  },

  reorderCategorySymbols(categoryId, symbolIds = []) {
    const categoryIdNum = Number(categoryId);
    const ids = Array.isArray(symbolIds)
      ? symbolIds
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0)
      : [];
    if (!Number.isFinite(categoryIdNum) || categoryIdNum <= 0 || !ids.length) {
      return this.listSymbols({ categoryId: categoryIdNum, onlyActive: false });
    }

    const db = getDb();
    const stmt = db.prepare(`
      UPDATE monitor_symbols
      SET sort_order = @sortOrder,
          updated_at = datetime('now')
      WHERE id = @id AND category_id = @categoryId
    `);
    const tx = db.transaction((orderedIds) => {
      orderedIds.forEach((item, index) => {
        stmt.run({
          id: item,
          categoryId: categoryIdNum,
          sortOrder: (index + 1) * 10,
        });
      });
    });
    tx(ids);
    return this.listSymbols({ categoryId: categoryIdNum, onlyActive: false });
  },
};

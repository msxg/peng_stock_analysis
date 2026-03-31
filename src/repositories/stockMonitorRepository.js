import { getDb } from '../db/database.js';

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
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    stockCode: row.stock_code,
    market: row.market,
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
      FROM stock_monitor_categories
      ORDER BY sort_order ASC, id ASC
    `).all().map(mapCategory);
  },

  getCategoryById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM stock_monitor_categories WHERE id = ?').get(id);
    return mapCategory(row);
  },

  createCategory({ name, description, sortOrder = 100, isEnabled = true }) {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO stock_monitor_categories (name, description, sort_order, is_enabled, created_at, updated_at)
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
      UPDATE stock_monitor_categories
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
    return db.prepare('DELETE FROM stock_monitor_categories WHERE id = ?').run(id).changes;
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
      UPDATE stock_monitor_categories
      SET sort_order = @sortOrder,
          updated_at = datetime('now')
      WHERE id = @id
    `);
    const tx = db.transaction((orderedIds) => {
      orderedIds.forEach((id, index) => {
        stmt.run({
          id,
          sortOrder: (index + 1) * 10,
        });
      });
    });
    tx(ids);
    return this.listCategories();
  },

  listSymbols({ categoryId, onlyActive = true } = {}) {
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

    return db.prepare(`
      SELECT *
      FROM stock_monitor_symbols
      WHERE ${where.join(' AND ')}
      ORDER BY sort_order ASC, id ASC
    `).all(params).map(mapSymbol);
  },

  createSymbol(item) {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO stock_monitor_symbols (
        category_id, name, stock_code, market, sort_order, is_active, created_at, updated_at
      )
      VALUES (
        @categoryId, @name, @stockCode, @market, @sortOrder, @isActive, datetime('now'), datetime('now')
      )
    `).run({
      categoryId: item.categoryId,
      name: item.name,
      stockCode: item.stockCode,
      market: item.market,
      sortOrder: item.sortOrder ?? 100,
      isActive: item.isActive === false ? 0 : 1,
    });
    return this.getSymbolById(result.lastInsertRowid);
  },

  getSymbolById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM stock_monitor_symbols WHERE id = ?').get(id);
    return mapSymbol(row);
  },

  deleteSymbol(id) {
    const db = getDb();
    return db.prepare('DELETE FROM stock_monitor_symbols WHERE id = ?').run(id).changes;
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
      UPDATE stock_monitor_symbols
      SET sort_order = @sortOrder,
          updated_at = datetime('now')
      WHERE id = @id AND category_id = @categoryId
    `);
    const tx = db.transaction((orderedIds) => {
      orderedIds.forEach((id, index) => {
        stmt.run({
          id,
          categoryId: categoryIdNum,
          sortOrder: (index + 1) * 10,
        });
      });
    });
    tx(ids);
    return this.listSymbols({ categoryId: categoryIdNum, onlyActive: false });
  },
};

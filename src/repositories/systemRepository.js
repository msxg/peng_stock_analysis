import { getDb } from '../db/database.js';
import { CONFIG_CATEGORIES } from '../constants/defaultConfig.js';

export const systemRepository = {
  getAuthSettings() {
    const db = getDb();
    const row = db.prepare('SELECT auth_enabled, password_changeable, updated_at FROM auth_settings WHERE id = 1').get();
    return {
      authEnabled: Boolean(row?.auth_enabled),
      passwordChangeable: Boolean(row?.password_changeable),
      updatedAt: row?.updated_at || null,
    };
  },

  updateAuthSettings({ authEnabled, passwordChangeable = true }) {
    const db = getDb();
    db.prepare(`
      UPDATE auth_settings
      SET auth_enabled = @authEnabled,
          password_changeable = @passwordChangeable,
          updated_at = datetime('now')
      WHERE id = 1
    `).run({ authEnabled: authEnabled ? 1 : 0, passwordChangeable: passwordChangeable ? 1 : 0 });
    return this.getAuthSettings();
  },

  findUserByUsername(username) {
    const db = getDb();
    return db.prepare('SELECT id, username, password_hash, created_at FROM users WHERE username = ?').get(username);
  },

  updateUserPassword(username, hash) {
    const db = getDb();
    db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, username);
  },

  listConfigItems() {
    const db = getDb();
    return db
      .prepare('SELECT key, value, category, title, description, updated_at FROM system_configs ORDER BY category, id')
      .all();
  },

  getConfigValue(key) {
    const db = getDb();
    const row = db.prepare('SELECT value FROM system_configs WHERE key = ?').get(key);
    return row?.value;
  },

  upsertConfigItems(items) {
    const db = getDb();
    const statement = db.prepare(`
      INSERT INTO system_configs (key, value, category, title, description, updated_at)
      VALUES (@key, @value, @category, @title, @description, datetime('now'))
      ON CONFLICT(key)
      DO UPDATE SET
        value = excluded.value,
        category = excluded.category,
        title = excluded.title,
        description = excluded.description,
        updated_at = datetime('now')
    `);

    const tx = db.transaction((payload) => {
      payload.forEach((item) => statement.run(item));
    });

    tx(items);
    return this.listConfigItems();
  },

  buildConfigCategories(items) {
    const grouped = new Map();
    items.forEach((item) => {
      if (!grouped.has(item.category)) grouped.set(item.category, []);
      grouped.get(item.category).push(item);
    });

    return CONFIG_CATEGORIES.map((category) => ({
      ...category,
      count: grouped.get(category.category)?.length || 0,
    }));
  },
};

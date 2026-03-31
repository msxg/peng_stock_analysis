import { getDb } from '../db/database.js';

export const portfolioRepository = {
  createAccount({ name, baseCurrency }) {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO portfolio_accounts (name, base_currency, created_at, updated_at)
      VALUES (?, ?, datetime('now'), datetime('now'))
    `).run(name, baseCurrency || 'CNY');
    return this.getAccountById(result.lastInsertRowid);
  },

  listAccounts() {
    const db = getDb();
    return db.prepare('SELECT * FROM portfolio_accounts ORDER BY id DESC').all().map((row) => ({
      id: row.id,
      name: row.name,
      baseCurrency: row.base_currency,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  },

  getAccountById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM portfolio_accounts WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      baseCurrency: row.base_currency,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },

  updateAccount(id, { name, baseCurrency }) {
    const db = getDb();
    db.prepare(`
      UPDATE portfolio_accounts
      SET name = COALESCE(@name, name),
          base_currency = COALESCE(@baseCurrency, base_currency),
          updated_at = datetime('now')
      WHERE id = @id
    `).run({ id, name: name || null, baseCurrency: baseCurrency || null });
    return this.getAccountById(id);
  },

  deleteAccount(id) {
    const db = getDb();
    return db.prepare('DELETE FROM portfolio_accounts WHERE id = ?').run(id).changes;
  },

  createTrade(item) {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO portfolio_trades (
        account_id, stock_code, market, side, quantity, price, fee, trade_date, note, created_at
      ) VALUES (
        @accountId, @stockCode, @market, @side, @quantity, @price, @fee, @tradeDate, @note, datetime('now')
      )
    `).run({
      accountId: item.accountId,
      stockCode: item.stockCode,
      market: item.market || null,
      side: item.side,
      quantity: item.quantity,
      price: item.price,
      fee: item.fee || 0,
      tradeDate: item.tradeDate,
      note: item.note || null,
    });

    return { eventId: result.lastInsertRowid };
  },

  listTrades({ accountId, stockCode, limit = 200 }) {
    const db = getDb();
    const where = ['1 = 1'];
    const params = { limit };
    if (accountId) {
      where.push('account_id = @accountId');
      params.accountId = accountId;
    }
    if (stockCode) {
      where.push('stock_code = @stockCode');
      params.stockCode = stockCode;
    }

    return db.prepare(`
      SELECT * FROM portfolio_trades
      WHERE ${where.join(' AND ')}
      ORDER BY trade_date DESC, id DESC
      LIMIT @limit
    `).all(params).map((row) => ({
      id: row.id,
      accountId: row.account_id,
      stockCode: row.stock_code,
      market: row.market,
      side: row.side,
      quantity: row.quantity,
      price: row.price,
      fee: row.fee,
      tradeDate: row.trade_date,
      note: row.note,
      createdAt: row.created_at,
    }));
  },

  createCashLedger(item) {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO portfolio_cash_ledger (
        account_id, type, amount, currency, occurred_at, note, created_at
      ) VALUES (
        @accountId, @type, @amount, @currency, @occurredAt, @note, datetime('now')
      )
    `).run({
      accountId: item.accountId,
      type: item.type,
      amount: item.amount,
      currency: item.currency || 'CNY',
      occurredAt: item.occurredAt,
      note: item.note || null,
    });

    return { eventId: result.lastInsertRowid };
  },

  listCashLedger({ accountId, limit = 300 }) {
    const db = getDb();
    const where = accountId ? 'WHERE account_id = ?' : '';
    const rows = accountId
      ? db.prepare(`SELECT * FROM portfolio_cash_ledger ${where} ORDER BY occurred_at DESC, id DESC LIMIT ?`).all(accountId, limit)
      : db.prepare('SELECT * FROM portfolio_cash_ledger ORDER BY occurred_at DESC, id DESC LIMIT ?').all(limit);

    return rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      type: row.type,
      amount: row.amount,
      currency: row.currency,
      occurredAt: row.occurred_at,
      note: row.note,
      createdAt: row.created_at,
    }));
  },

  createCorporateAction(item) {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO portfolio_corporate_actions (
        account_id, stock_code, action_type, ratio, cash_amount, effective_date, note, created_at
      ) VALUES (
        @accountId, @stockCode, @actionType, @ratio, @cashAmount, @effectiveDate, @note, datetime('now')
      )
    `).run({
      accountId: item.accountId,
      stockCode: item.stockCode,
      actionType: item.actionType,
      ratio: item.ratio || null,
      cashAmount: item.cashAmount || null,
      effectiveDate: item.effectiveDate,
      note: item.note || null,
    });

    return { eventId: result.lastInsertRowid };
  },

  listCorporateActions({ accountId, limit = 300 }) {
    const db = getDb();
    const where = accountId ? 'WHERE account_id = ?' : '';
    const rows = accountId
      ? db.prepare(`SELECT * FROM portfolio_corporate_actions ${where} ORDER BY effective_date DESC, id DESC LIMIT ?`).all(accountId, limit)
      : db.prepare('SELECT * FROM portfolio_corporate_actions ORDER BY effective_date DESC, id DESC LIMIT ?').all(limit);

    return rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      stockCode: row.stock_code,
      actionType: row.action_type,
      ratio: row.ratio,
      cashAmount: row.cash_amount,
      effectiveDate: row.effective_date,
      note: row.note,
      createdAt: row.created_at,
    }));
  },
};

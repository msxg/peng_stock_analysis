import { portfolioService } from '../services/portfolioService.js';

export const portfolioController = {
  createAccount(req, res) {
    res.json(portfolioService.createAccount(req.body || {}));
  },

  listAccounts(_req, res) {
    res.json({ items: portfolioService.listAccounts() });
  },

  updateAccount(req, res) {
    res.json(portfolioService.updateAccount(Number(req.params.accountId), req.body || {}));
  },

  deleteAccount(req, res) {
    res.json(portfolioService.deleteAccount(Number(req.params.accountId)));
  },

  createTrade(req, res) {
    res.json(portfolioService.createTrade(req.body || {}));
  },

  listTrades(req, res) {
    res.json({
      items: portfolioService.listTrades({
        accountId: req.query.accountId ? Number(req.query.accountId) : undefined,
        stockCode: req.query.stockCode ? String(req.query.stockCode).toUpperCase() : undefined,
        limit: Number(req.query.limit || 200),
      }),
    });
  },

  createCashLedger(req, res) {
    res.json(portfolioService.createCashLedger(req.body || {}));
  },

  listCashLedger(req, res) {
    res.json({
      items: portfolioService.listCashLedger({
        accountId: req.query.accountId ? Number(req.query.accountId) : undefined,
        limit: Number(req.query.limit || 200),
      }),
    });
  },

  createCorporateAction(req, res) {
    res.json(portfolioService.createCorporateAction(req.body || {}));
  },

  listCorporateActions(req, res) {
    res.json({
      items: portfolioService.listCorporateActions({
        accountId: req.query.accountId ? Number(req.query.accountId) : undefined,
        limit: Number(req.query.limit || 200),
      }),
    });
  },

  async snapshot(req, res) {
    const result = await portfolioService.getSnapshot({
      accountId: req.query.accountId ? Number(req.query.accountId) : undefined,
    });
    res.json(result);
  },

  async riskReport(req, res) {
    const result = await portfolioService.getRiskReport({
      accountId: req.query.accountId ? Number(req.query.accountId) : undefined,
    });
    res.json(result);
  },
};

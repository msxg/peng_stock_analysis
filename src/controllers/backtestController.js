import { backtestService } from '../services/backtestService.js';

export const backtestController = {
  async run(req, res) {
    const payload = await backtestService.runBacktest({
      stockCode: req.body?.stockCode,
      evaluationDays: Number(req.body?.evaluationDays || 5),
      force: Boolean(req.body?.force),
    });
    res.json(payload);
  },

  list(req, res) {
    const payload = backtestService.listResults({
      stockCode: req.query.stockCode,
      evaluationDays: req.query.evaluationDays ? Number(req.query.evaluationDays) : undefined,
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 50),
    });
    res.json(payload);
  },

  overall(req, res) {
    res.json(backtestService.getOverallPerformance(Number(req.query.evaluationDays || 5)));
  },

  byStock(req, res) {
    res.json(backtestService.getStockPerformance(Number(req.query.evaluationDays || 5)));
  },
};

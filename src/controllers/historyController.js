import { historyService } from '../services/historyService.js';

export const historyController = {
  list(req, res) {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    const startDate = req.query.startDate ? String(req.query.startDate) : undefined;
    const endDate = req.query.endDate ? String(req.query.endDate) : undefined;
    const stockCode = req.query.stockCode ? String(req.query.stockCode).toUpperCase() : undefined;

    res.json(historyService.list({ page, limit, startDate, endDate, stockCode }));
  },

  detail(req, res) {
    res.json(historyService.getDetail(Number(req.params.id)));
  },

  markdown(req, res) {
    res.json(historyService.getMarkdown(Number(req.params.id)));
  },

  news(req, res) {
    res.json(historyService.getNews(Number(req.params.id)));
  },

  deleteBatch(req, res) {
    const ids = Array.isArray(req.body?.recordIds)
      ? req.body.recordIds.map((item) => Number(item)).filter((item) => Number.isFinite(item))
      : [];
    res.json(historyService.deleteBatch(ids));
  },
};

import { stockMonitorService } from '../services/stockMonitorService.js';

export const stockMonitorController = {
  timeframes(_req, res) {
    res.json({
      items: stockMonitorService.getTimeframes(),
    });
  },

  listCategories(_req, res) {
    res.json({
      items: stockMonitorService.listCategories(),
    });
  },

  createCategory(req, res) {
    const item = stockMonitorService.createCategory(req.body || {});
    res.status(201).json(item);
  },

  updateCategory(req, res) {
    const item = stockMonitorService.updateCategory(req.params.categoryId, req.body || {});
    res.json(item);
  },

  deleteCategory(req, res) {
    const item = stockMonitorService.deleteCategory(req.params.categoryId);
    res.json({
      deleted: true,
      item,
    });
  },

  moveCategory(req, res) {
    const payload = stockMonitorService.moveCategory(req.params.categoryId, req.body || {});
    res.json(payload);
  },

  async createSymbol(req, res) {
    const item = await stockMonitorService.createSymbol(req.body || {});
    res.status(201).json(item);
  },

  deleteSymbol(req, res) {
    const item = stockMonitorService.deleteSymbol(req.params.symbolId);
    res.json({
      deleted: true,
      item,
    });
  },

  moveSymbol(req, res) {
    const payload = stockMonitorService.moveSymbol(req.params.symbolId, req.body || {});
    res.json(payload);
  },

  async monitor(req, res) {
    const payload = await stockMonitorService.getMonitor({
      categoryId: req.query.categoryId,
      stockCode: req.query.stockCode,
      quoteCode: req.query.quoteCode,
      code: req.query.code,
      timeframe: req.query.timeframe,
      limit: req.query.limit,
    });
    res.json(payload);
  },
};

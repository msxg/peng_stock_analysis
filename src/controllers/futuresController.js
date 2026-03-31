import { futuresService } from '../services/futuresService.js';

export const futuresController = {
  timeframes(_req, res) {
    res.json({
      items: futuresService.getTimeframes(),
    });
  },

  async presets(req, res) {
    const payload = await futuresService.listPresets({
      force: req.query.force === '1' || req.query.refresh === '1',
    });
    res.json(payload);
  },

  async resolve(req, res) {
    const input = req.query.code || req.query.quoteCode || req.query.q;
    const payload = await futuresService.resolveSymbol(input, {
      nameHint: req.query.name || req.query.nameHint || '',
    });
    res.json(payload);
  },

  listCategories(_req, res) {
    res.json({
      items: futuresService.listCategories(),
    });
  },

  createCategory(req, res) {
    const item = futuresService.createCategory(req.body || {});
    res.status(201).json(item);
  },

  updateCategory(req, res) {
    const item = futuresService.updateCategory(req.params.categoryId, req.body || {});
    res.json(item);
  },

  deleteCategory(req, res) {
    const item = futuresService.deleteCategory(req.params.categoryId);
    res.json({
      deleted: true,
      item,
    });
  },

  async createSymbol(req, res) {
    const item = await futuresService.createSymbol(req.body || {});
    res.status(201).json(item);
  },

  deleteSymbol(req, res) {
    const item = futuresService.deleteSymbol(req.params.symbolId);
    res.json({
      deleted: true,
      item,
    });
  },

  async monitor(req, res) {
    const payload = await futuresService.getMonitor({
      categoryId: req.query.categoryId,
      quoteCode: req.query.quoteCode,
      timeframe: req.query.timeframe,
      limit: req.query.limit,
    });
    res.json(payload);
  },
};

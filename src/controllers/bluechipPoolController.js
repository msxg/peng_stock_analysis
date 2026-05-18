import { bluechipPoolService } from '../services/bluechipPoolService.js';

export const bluechipPoolController = {
  listPools(_req, res) {
    res.json({
      items: bluechipPoolService.listPools({ onlyEnabled: false }),
    });
  },

  createPool(req, res) {
    const item = bluechipPoolService.createPool(req.body || {});
    res.status(201).json(item);
  },

  updatePool(req, res) {
    const item = bluechipPoolService.updatePool(req.params.poolId, req.body || {});
    res.json(item);
  },

  deletePool(req, res) {
    const item = bluechipPoolService.deletePool(req.params.poolId);
    res.json({
      deleted: true,
      item,
    });
  },

  createSymbol(req, res) {
    const item = bluechipPoolService.createPoolSymbol(req.params.poolId, req.body || {});
    res.status(201).json(item);
  },

  updateSymbol(req, res) {
    const item = bluechipPoolService.updatePoolSymbol(req.params.poolId, req.params.symbolId, req.body || {});
    res.json(item);
  },

  deleteSymbol(req, res) {
    const item = bluechipPoolService.deletePoolSymbol(req.params.poolId, req.params.symbolId);
    res.json({
      deleted: true,
      item,
    });
  },

  clearSymbols(req, res) {
    const result = bluechipPoolService.clearPoolSymbols(req.params.poolId);
    res.json({
      cleared: true,
      ...result,
    });
  },
};

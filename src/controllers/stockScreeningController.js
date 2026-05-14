import { stockScreeningService } from '../services/stockScreeningService.js';

export const stockScreeningController = {
  query(req, res) {
    const payload = stockScreeningService.query(req.body || {});
    res.json(payload);
  },

  async addToMonitor(req, res) {
    const payload = await stockScreeningService.addToMonitor(req.body || {});
    res.json(payload);
  },

  addToBluechipPool(req, res) {
    const payload = stockScreeningService.addToBluechipPool(req.body || {});
    res.json(payload);
  },
};

import { usageService } from '../services/usageService.js';

export const usageController = {
  summary(req, res) {
    res.json(usageService.getSummary(req.query.period || '7d'));
  },
};

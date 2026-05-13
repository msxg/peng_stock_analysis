import { marketMetricsService } from '../services/marketMetricsService.js';

function parseBooleanLike(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

export const marketMetricsController = {
  listRules(req, res) {
    const payload = marketMetricsService.listRules({
      enabledOnly: parseBooleanLike(req.query.enabledOnly, false),
    });
    res.json(payload);
  },

  createRule(req, res) {
    const payload = marketMetricsService.createRule(req.body || {});
    res.status(201).json(payload);
  },

  updateRule(req, res) {
    const payload = marketMetricsService.updateRule(req.params.ruleId, req.body || {});
    res.json(payload);
  },

  daily(req, res) {
    const payload = marketMetricsService.getDaily({
      tradeDay: req.query.tradeDay,
      scopeKey: req.query.scopeKey,
      ruleKey: req.query.ruleKey,
    });
    res.json(payload);
  },

  dailyRange(req, res) {
    const payload = marketMetricsService.getDailyRange({
      startDay: req.query.startDay,
      endDay: req.query.endDay,
      scopeKey: req.query.scopeKey,
      ruleKey: req.query.ruleKey,
      limit: req.query.limit,
    });
    res.json(payload);
  },

  compute(req, res) {
    const payload = marketMetricsService.compute(req.body || {});
    res.json(payload);
  },
};

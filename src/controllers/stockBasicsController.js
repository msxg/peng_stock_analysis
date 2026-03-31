import { stockBasicsService } from '../services/stockBasicsService.js';

function parseBooleanLike(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

export const stockBasicsController = {
  async sync(_req, res) {
    const payload = await stockBasicsService.syncBasics();
    res.json(payload);
  },

  search(req, res) {
    const payload = stockBasicsService.searchBasics({
      q: req.query.q,
      market: req.query.market,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(payload);
  },

  async suggest(req, res) {
    const payload = await stockBasicsService.suggestBasics({
      q: req.query.q,
      market: req.query.market,
      limit: req.query.limit,
    });
    res.json(payload);
  },

  async detail(req, res) {
    const payload = await stockBasicsService.getBasicDetail(req.params.code, {
      market: req.query.market,
      localOnly: parseBooleanLike(req.query.localOnly, false),
    });
    res.json(payload);
  },
};

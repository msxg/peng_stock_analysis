import { marketDataService } from '../services/marketDataService.js';

export const marketDataController = {
  futuresIntraday(req, res) {
    const payload = marketDataService.queryFuturesIntraday(req.query || {});
    res.json(payload);
  },

  async syncFuturesIntraday(req, res) {
    const payload = await marketDataService.syncFuturesIntraday(req.body || {});
    res.json(payload);
  },
};

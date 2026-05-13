import { marketDataService } from '../services/marketDataService.js';

export const marketDataController = {
  query(req, res) {
    const payload = marketDataService.queryMarketData(req.query || {});
    res.json(payload);
  },

  futuresIntraday(req, res) {
    const query = req.query || {};
    const payload = query.symbolType
      ? marketDataService.queryMarketData(query)
      : marketDataService.queryFuturesIntraday(query);
    res.json(payload);
  },

  async sync(req, res) {
    const payload = await marketDataService.syncMarketData(req.body || {});
    res.json(payload);
  },

  async syncFuturesIntraday(req, res) {
    const body = req.body || {};
    const payload = body.symbolType
      ? await marketDataService.syncMarketData(body)
      : await marketDataService.syncFuturesIntraday(body);
    res.json(payload);
  },

  jobs(req, res) {
    const payload = marketDataService.listSyncJobs(req.query || {});
    res.json(payload);
  },

  quality(req, res) {
    const payload = marketDataService.listQualityReports(req.query || {});
    res.json(payload);
  },
};

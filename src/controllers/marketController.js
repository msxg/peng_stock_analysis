import { marketReviewService } from '../services/marketReviewService.js';

export const marketController = {
  async review(req, res) {
    const region = String(req.query.region || 'both').toLowerCase();
    const safeRegion = ['cn', 'us', 'both'].includes(region) ? region : 'both';
    const payload = await marketReviewService.getMarketReview(safeRegion);
    res.json(payload);
  },
};

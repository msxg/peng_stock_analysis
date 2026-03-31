import { analysisRepository } from '../repositories/analysisRepository.js';
import { HttpError } from '../utils/httpError.js';

export const historyService = {
  list(params) {
    return analysisRepository.listHistory(params);
  },

  getDetail(id) {
    const item = analysisRepository.getHistoryById(id);
    if (!item) throw new HttpError(404, '历史记录不存在');
    const extended = item.technical?.extended || {};
    return {
      ...item,
      sentiment: extended.sentiment || null,
      fundamental_context: extended.fundamental_context || null,
      strategy: extended.strategy || null,
      market_review: extended.market_review || null,
      dashboard: extended.dashboard || null,
      newsMeta: extended.newsMeta || null,
      disclaimer: extended.disclaimer || '仅供参考，不构成投资建议。',
    };
  },

  getMarkdown(id) {
    const item = this.getDetail(id);
    return {
      id: item.id,
      stockCode: item.stockCode,
      markdown: item.reportMarkdown,
    };
  },

  getNews(id) {
    const item = this.getDetail(id);
    return {
      id: item.id,
      stockCode: item.stockCode,
      news: item.news || [],
    };
  },

  deleteBatch(ids) {
    const deleted = analysisRepository.deleteHistoryByIds(ids);
    return { deleted };
  },
};

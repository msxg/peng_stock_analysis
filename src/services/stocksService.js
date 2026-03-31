import { stockDataService } from './stockDataService.js';
import { importService } from './importService.js';

export const stocksService = {
  async getQuote(stockCode) {
    return stockDataService.getQuote(stockCode);
  },

  async getHistory(stockCode, { days = 180 } = {}) {
    const payload = await stockDataService.getHistory(stockCode, { days });
    return {
      stockCode: payload.quote.stockCode,
      stockName: payload.quote.stockName,
      market: payload.quote.market,
      items: payload.history,
    };
  },

  async parseImport({ text, file }) {
    if (file) {
      return importService.parseFromFile(file);
    }
    return importService.parseFromText(text || '');
  },

  async extractFromImage(file) {
    return importService.extractFromImage(file);
  },
};

import { stocksService } from '../services/stocksService.js';

export const stocksController = {
  async quote(req, res) {
    const quote = await stocksService.getQuote(req.params.stockCode);
    res.json(quote);
  },

  async history(req, res) {
    const days = Number(req.query.days || 180);
    const payload = await stocksService.getHistory(req.params.stockCode, { days });
    res.json(payload);
  },

  async parseImport(req, res) {
    const items = await stocksService.parseImport({
      text: req.body?.text || '',
      file: req.file,
    });

    res.json({
      total: items.length,
      items,
    });
  },

  async extractFromImage(req, res) {
    const items = await stocksService.extractFromImage(req.file);
    res.json({
      total: items.length,
      items,
      note: '当前版本采用轻量提取策略，建议上传带股票代码的清晰截图。',
    });
  },
};

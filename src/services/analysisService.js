import { taskService } from './taskService.js';
import { parseStockList } from '../utils/stockCode.js';
import { HttpError } from '../utils/httpError.js';
import { analysisEngineService } from './analysisEngineService.js';
import { analysisRepository } from '../repositories/analysisRepository.js';
import { notificationService } from './notificationService.js';

function resolveStockCodes({ stockCodes, stockList }) {
  if (Array.isArray(stockCodes) && stockCodes.length) {
    return Array.from(new Set(stockCodes.map((item) => String(item).trim().toUpperCase()).filter(Boolean)));
  }

  if (typeof stockList === 'string' && stockList.trim()) {
    return parseStockList(stockList);
  }

  return [];
}

export const analysisService = {
  async triggerAnalysis(payload) {
    const stocks = resolveStockCodes(payload);
    if (!stocks.length) {
      throw new HttpError(400, '请提供至少一个股票代码');
    }

    const runAsync = payload?.async !== false;

    if (runAsync) {
      const task = taskService.createTask(stocks, {
        marketReview: Boolean(payload?.marketReview),
        forceRun: Boolean(payload?.forceRun),
      });
      return {
        mode: 'async',
        task,
      };
    }

    const results = [];
    for (const code of stocks) {
      const result = await analysisEngineService.analyzeStock(code);
      const saved = analysisRepository.createHistory(result);
      results.push(saved);
    }

    analysisRepository.logUsage({
      eventType: 'analysis_sync',
      model: 'heuristic-v1',
      tokenIn: stocks.length * 200,
      tokenOut: stocks.length * 500,
      cost: 0,
    });

    let emailNotification = null;
    try {
      emailNotification = await notificationService.sendAnalysisEmail({
        source: 'sync',
        taskId: null,
        results,
      });
    } catch (error) {
      emailNotification = { sent: false, reason: `邮件发送失败: ${error.message}` };
    }

    return {
      mode: 'sync',
      total: results.length,
      items: results,
      emailNotification,
    };
  },

  listTasks({ limit = 50, status }) {
    return taskService.listTasks(limit, status);
  },

  getTaskStatus(taskId) {
    const task = taskService.getTask(taskId);
    if (!task) throw new HttpError(404, '任务不存在');
    return task;
  },
};

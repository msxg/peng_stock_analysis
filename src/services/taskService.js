import { randomUUID } from 'crypto';
import { analysisRepository } from '../repositories/analysisRepository.js';
import { systemRepository } from '../repositories/systemRepository.js';
import { analysisEngineService } from './analysisEngineService.js';
import { taskStream } from '../events/taskStream.js';
import { HttpError } from '../utils/httpError.js';
import { notificationService } from './notificationService.js';

class TaskService {
  constructor() {
    this.queue = [];
    this.running = 0;
  }

  getConcurrency() {
    const raw = Number(systemRepository.getConfigValue('ANALYSIS_CONCURRENCY') || 2);
    return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 8) : 2;
  }

  checkDuplicate(stocks) {
    const active = analysisRepository
      .listTasks(200)
      .filter((task) => ['queued', 'running'].includes(task.status));

    for (const task of active) {
      const overlap = task.stockCodes.find((code) => stocks.includes(code));
      if (overlap) {
        throw new HttpError(409, `股票 ${overlap} 已存在进行中的分析任务`, {
          taskId: task.taskId,
          stockCode: overlap,
        });
      }
    }
  }

  createTask(stockCodes, params = {}) {
    this.checkDuplicate(stockCodes);

    const task = {
      taskId: randomUUID(),
      queryId: randomUUID(),
      stockCodes,
      status: 'queued',
      params,
    };

    analysisRepository.createTask(task);
    taskStream.publish('task_created', task);

    this.queue.push(task.taskId);
    this.schedule();

    return analysisRepository.getTask(task.taskId);
  }

  schedule() {
    const limit = this.getConcurrency();
    while (this.running < limit && this.queue.length > 0) {
      const taskId = this.queue.shift();
      if (!taskId) continue;
      this.processTask(taskId);
    }
  }

  async processTask(taskId) {
    const task = analysisRepository.getTask(taskId);
    if (!task) return;

    this.running += 1;
    analysisRepository.updateTask(taskId, { status: 'running' });
    taskStream.publish('task_started', analysisRepository.getTask(taskId));

    const results = [];

    try {
      for (let i = 0; i < task.stockCodes.length; i += 1) {
        const stockCode = task.stockCodes[i];
        taskStream.publish('task_progress', {
          taskId,
          stockCode,
          progress: Number((((i + 1) / task.stockCodes.length) * 100).toFixed(1)),
          index: i + 1,
          total: task.stockCodes.length,
        });

        const result = await analysisEngineService.analyzeStock(stockCode);
        const saved = analysisRepository.createHistory(result);
        results.push(saved);
      }

      const taskResult = {
        queryId: task.queryId,
        total: results.length,
        historyIds: results.map((item) => item.id),
        items: results,
      };

      analysisRepository.updateTask(taskId, {
        status: 'completed',
        result: taskResult,
      });

      let emailNotification = null;
      try {
        emailNotification = await notificationService.sendAnalysisEmail({
          source: 'async',
          taskId,
          results,
        });
      } catch (error) {
        emailNotification = { sent: false, reason: `邮件发送失败: ${error.message}` };
      }

      taskResult.emailNotification = emailNotification;
      analysisRepository.updateTask(taskId, { result: taskResult });

      const latest = analysisRepository.getTask(taskId);
      taskStream.publish('task_completed', latest);
    } catch (error) {
      analysisRepository.updateTask(taskId, {
        status: 'failed',
        error: error.message,
      });
      const latest = analysisRepository.getTask(taskId);
      taskStream.publish('task_failed', latest);
    } finally {
      this.running -= 1;
      this.schedule();
    }
  }

  getTask(taskId) {
    return analysisRepository.getTask(taskId);
  }

  listTasks(limit, status) {
    return analysisRepository.listTasks(limit, status);
  }
}

export const taskService = new TaskService();

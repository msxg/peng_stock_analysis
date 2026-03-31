import { analysisService } from '../services/analysisService.js';
import { taskStream } from '../events/taskStream.js';

export const analysisController = {
  async trigger(req, res) {
    const result = await analysisService.triggerAnalysis(req.body || {});
    res.json(result);
  },

  listTasks(req, res) {
    const limit = Number(req.query.limit || 50);
    const status = req.query.status ? String(req.query.status) : undefined;
    res.json({ items: analysisService.listTasks({ limit, status }) });
  },

  getStatus(req, res) {
    res.json(analysisService.getTaskStatus(req.params.taskId));
  },

  stream(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    taskStream.subscribe(res);

    req.on('close', () => {
      taskStream.unsubscribe(res);
    });
  },
};

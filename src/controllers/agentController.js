import { agentService } from '../services/agentService.js';

function streamByChunk(res, text, interval = 35) {
  let index = 0;
  const chunks = text.match(/.{1,16}/g) || [text];

  const timer = setInterval(() => {
    if (index >= chunks.length) {
      res.write('event: done\n');
      res.write('data: {}\n\n');
      clearInterval(timer);
      res.end();
      return;
    }

    res.write('event: chunk\n');
    res.write(`data: ${JSON.stringify({ content: chunks[index] })}\n\n`);
    index += 1;
  }, interval);
}

export const agentController = {
  models(_req, res) {
    res.json({ items: agentService.getModels() });
  },

  strategies(_req, res) {
    res.json({ items: agentService.getStrategies() });
  },

  async chat(req, res) {
    const result = await agentService.chat({
      message: req.body?.message,
      sessionId: req.body?.sessionId,
      userId: req.user?.username || 'web',
      strategies: req.body?.strategies,
    });
    res.json(result);
  },

  async chatStream(req, res) {
    const result = await agentService.chat({
      message: req.body?.message,
      sessionId: req.body?.sessionId,
      userId: req.user?.username || 'web',
      strategies: req.body?.strategies,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    streamByChunk(res, result.message);
  },

  listSessions(req, res) {
    const limit = Number(req.query.limit || 50);
    res.json({ items: agentService.listSessions({ limit, userId: req.query.userId }) });
  },

  sessionMessages(req, res) {
    const limit = Number(req.query.limit || 100);
    res.json({ items: agentService.getSessionMessages(req.params.sessionId, limit) });
  },

  deleteSession(req, res) {
    res.json(agentService.deleteSession(req.params.sessionId));
  },

  async sendToNotification(req, res) {
    const result = await agentService.chat({
      message: req.body?.message,
      sessionId: req.body?.sessionId,
      userId: req.user?.username || 'web',
      strategies: req.body?.strategies,
    });
    res.json({ success: true, payload: result });
  },
};

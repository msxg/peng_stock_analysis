export const healthController = {
  check(_req, res) {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'peng-stock-analysis',
    });
  },
};

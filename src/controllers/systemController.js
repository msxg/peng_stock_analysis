import { systemConfigService } from '../services/systemConfigService.js';
import { notificationService } from '../services/notificationService.js';

export const systemController = {
  getConfig(req, res) {
    const maskToken = req.query.maskToken !== 'false';
    res.json(systemConfigService.getSystemConfig({ maskToken }));
  },

  updateConfig(req, res) {
    const result = systemConfigService.updateSystemConfig(req.body || {});
    res.json(result);
  },

  validateConfig(req, res) {
    res.json(systemConfigService.validateSystemConfig(req.body || {}));
  },

  testLlmChannel(_req, res) {
    res.json(systemConfigService.testLlmChannel());
  },

  async testEmail(_req, res) {
    const result = await notificationService.sendTestEmail();
    res.json(result);
  },

  getSchema(_req, res) {
    res.json(systemConfigService.getSystemConfigSchema());
  },
};

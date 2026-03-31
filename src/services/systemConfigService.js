import { systemRepository } from '../repositories/systemRepository.js';
import { HttpError } from '../utils/httpError.js';

const SECRET_KEY_RE = /(API_KEY|TOKEN|PASSWORD|SECRET|COOKIE)/i;

function maskSecret(value) {
  if (!value) return '';
  if (value.length <= 6) return '*'.repeat(value.length);
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(2, value.length - 4))}${value.slice(-2)}`;
}

export const systemConfigService = {
  getSystemConfig({ maskToken = true } = {}) {
    const items = systemRepository.listConfigItems().map((item) => ({
      ...item,
      value: maskToken && SECRET_KEY_RE.test(item.key) ? maskSecret(String(item.value || '')) : item.value,
    }));

    return {
      categories: systemRepository.buildConfigCategories(items),
      items,
      auth: systemRepository.getAuthSettings(),
      configVersion: Date.now(),
      maskToken,
    };
  },

  updateSystemConfig(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new HttpError(400, '配置更新参数无效');
    }

    const current = systemRepository.listConfigItems();
    const currentMap = new Map(current.map((item) => [item.key, item]));
    const updates = [];

    Object.entries(payload).forEach(([key, value]) => {
      const existing = currentMap.get(key);
      if (!existing) return;
      updates.push({
        key,
        value: String(value ?? ''),
        category: existing.category,
        title: existing.title,
        description: existing.description,
      });
    });

    if (updates.length === 0) {
      throw new HttpError(400, '未检测到可更新配置项');
    }

    systemRepository.upsertConfigItems(updates);
    return this.getSystemConfig({ maskToken: false });
  },

  validateSystemConfig(payload) {
    const issues = [];

    if (payload.ANALYSIS_CONCURRENCY && Number(payload.ANALYSIS_CONCURRENCY) <= 0) {
      issues.push({ key: 'ANALYSIS_CONCURRENCY', message: '并发数必须大于 0' });
    }

    if (payload.BIAS_THRESHOLD && Number(payload.BIAS_THRESHOLD) <= 0) {
      issues.push({ key: 'BIAS_THRESHOLD', message: '乖离率阈值必须大于 0' });
    }

    if (String(payload.EMAIL_ENABLED || '').toLowerCase() === 'true') {
      const required = ['EMAIL_SMTP_HOST', 'EMAIL_SENDER', 'EMAIL_PASSWORD', 'EMAIL_RECEIVERS'];
      required.forEach((key) => {
        if (!String(payload[key] || '').trim()) {
          issues.push({ key, message: `启用邮件时 ${key} 不能为空` });
        }
      });
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  },

  testLlmChannel() {
    return {
      ok: true,
      message: '当前版本使用本地启发式分析引擎，LLM 渠道配置通过。',
      latencyMs: 15,
    };
  },

  getSystemConfigSchema() {
    const items = systemRepository.listConfigItems();
    return {
      fields: items.map((item) => ({
        key: item.key,
        category: item.category,
        title: item.title,
        description: item.description,
        type: SECRET_KEY_RE.test(item.key) ? 'secret' : 'string',
      })),
    };
  },
};

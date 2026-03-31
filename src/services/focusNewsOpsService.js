import { focusNewsRepository } from '../repositories/focusNewsRepository.js';
import { focusNewsScheduler } from './focusNewsScheduler.js';
import { HttpError } from '../utils/httpError.js';

function toSafeLimit(limit, fallback = 8) {
  const num = Number(limit);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.min(Math.trunc(num), 50));
}

export const focusNewsOpsService = {
  schedulerCategories(payload = {}) {
    const providerKey = String(payload.providerKey || 'tushare').trim() || 'tushare';
    const level = Number.isFinite(Number(payload.level)) ? Number(payload.level) : 2;
    const items = focusNewsRepository
      .listProviderCategories({ providerKey })
      .filter((item) => Number(item.level || 0) >= level);
    return { items };
  },

  schedulerCategoryPolicy(payload = {}) {
    const providerKey = String(payload.providerKey || 'tushare').trim() || 'tushare';
    const categoryKey = String(payload.categoryKey || '').trim();
    if (!categoryKey) {
      throw new HttpError(400, 'categoryKey 不能为空');
    }

    const hasEnabled = payload.schedulerEnabled !== undefined;
    const hasPriority = payload.schedulerPriority !== undefined;
    if (!hasEnabled && !hasPriority) {
      throw new HttpError(400, '未检测到可更新的调度策略字段');
    }

    const schedulerPriority = hasPriority
      ? Math.max(1, Math.min(Math.trunc(Number(payload.schedulerPriority) || 100), 9999))
      : undefined;
    const updated = focusNewsRepository.updateSchedulerCategoryPolicy({
      providerKey,
      categoryKey,
      schedulerEnabled: hasEnabled ? payload.schedulerEnabled !== false : undefined,
      schedulerPriority,
    });

    if (!updated) {
      throw new HttpError(404, `调度分类不存在: ${providerKey}/${categoryKey}`);
    }
    return { item: updated };
  },

  schedulerStatus(payload = {}) {
    const providerKey = String(payload.providerKey || 'tushare').trim() || 'tushare';
    const limit = toSafeLimit(payload.limit, 8);
    return {
      scheduler: focusNewsScheduler.getStatus({ providerKey }),
      recentRuns: focusNewsRepository.listSyncRuns({
        providerKey,
        limit,
        triggerType: 'scheduler',
      }),
    };
  },

  async schedulerRun(payload = {}) {
    const providerKey = String(payload.providerKey || 'tushare').trim() || 'tushare';
    const limit = toSafeLimit(payload.limit, 8);
    const triggered = await focusNewsScheduler.runNow({ providerKey });
    return {
      triggered,
      scheduler: focusNewsScheduler.getStatus({ providerKey }),
      recentRuns: focusNewsRepository.listSyncRuns({
        providerKey,
        limit,
        triggerType: 'scheduler',
      }),
    };
  },
};

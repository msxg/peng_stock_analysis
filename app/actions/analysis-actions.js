'use server';

import { triggerAnalysisServer } from '@/lib/server-api';

export async function triggerAnalysisAction(_prevState, formData) {
  const stockList = String(formData.get('stockList') || '').trim();
  const runAsync = formData.get('runAsync') === 'on';

  if (!stockList) {
    return { ok: false, message: '请输入至少一个股票代码' };
  }

  try {
    const payload = await triggerAnalysisServer({
      stockList,
      async: runAsync,
      marketReview: true,
    });

    return {
      ok: true,
      message: runAsync ? '异步任务已创建' : `同步分析完成，共 ${payload?.total || 0} 条`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error.message || '分析触发失败',
    };
  }
}

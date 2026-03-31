function evaluateCnMode(marketSentiment, trendBull) {
  if (marketSentiment >= 65 && trendBull) return '进攻';
  if (marketSentiment <= 40) return '防守';
  return '均衡';
}

function evaluateUsMode(marketSentiment, trendBull) {
  if (marketSentiment >= 65 && trendBull) return 'risk-on';
  if (marketSentiment <= 40) return 'risk-off';
  return 'neutral';
}

function buildCnPlan(mode) {
  if (mode === '进攻') {
    return [
      '优先关注强趋势主线，分批加仓，仓位上限可提升到 70%-80%。',
      '买点以回踩 MA5/MA10 + 放量企稳为主，不追高长上影。',
      '止损严格执行，单笔亏损控制在 5%-7%。',
    ];
  }
  if (mode === '防守') {
    return [
      '降低仓位到 20%-40%，优先持有低波高股息或现金流稳健标的。',
      '回避高弹性题材，缩短持股周期，防止连续回撤。',
      '只做确定性反弹，不做趋势猜底。',
    ];
  }
  return [
    '仓位维持在 40%-60%，进攻与防守均衡配置。',
    '优先做有业绩支撑的趋势延续和板块轮动低吸。',
    '单笔交易设置清晰止损，避免情绪化加仓。',
  ];
}

function buildUsPlan(mode) {
  if (mode === 'risk-on') {
    return [
      '增配成长与高 Beta 板块，优先强势行业龙头。',
      '采用趋势跟踪与回踩加仓，避免盘中情绪追涨。',
      '仓位可提升到 70% 左右，但保留防守对冲。',
    ];
  }
  if (mode === 'risk-off') {
    return [
      '增配防御性行业与短久期资产，降低高波动曝险。',
      '减少杠杆和集中持仓，优先保住净值曲线。',
      '严格执行止损与减仓纪律，避免左侧抄底。',
    ];
  }
  return [
    '保持中性风险暴露，平衡成长与防御。',
    '更多采用区间交易与事件驱动策略。',
    '等待宏观与盈利预期出现新方向再加大仓位。',
  ];
}

export const marketStrategyService = {
  buildStrategy({ market, marketSentiment, trendBull }) {
    const isUs = String(market).startsWith('US');

    if (isUs) {
      const mode = evaluateUsMode(marketSentiment, trendBull);
      return {
        system: 'Regime Strategy',
        mode,
        plan: buildUsPlan(mode),
        disclaimer: '仅供参考，不构成投资建议。',
      };
    }

    const mode = evaluateCnMode(marketSentiment, trendBull);
    return {
      system: '三段式复盘策略',
      mode,
      plan: buildCnPlan(mode),
      disclaimer: '仅供参考，不构成投资建议。',
    };
  },
};

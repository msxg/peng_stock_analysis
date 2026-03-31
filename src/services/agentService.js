import { randomUUID } from 'crypto';
import { AGENT_MODELS, STRATEGY_LIBRARY } from '../constants/defaultConfig.js';
import { chatRepository } from '../repositories/chatRepository.js';
import { systemRepository } from '../repositories/systemRepository.js';
import { stockDataService } from './stockDataService.js';
import { parseStockList, normalizeStockCode } from '../utils/stockCode.js';
import { HttpError } from '../utils/httpError.js';

function getEnabledSkills() {
  const raw = systemRepository.getConfigValue('AGENT_SKILLS') || '';
  const selected = parseStockList(raw.toLowerCase().replace(/_/g, '_').replace(/\s+/g, ','));
  if (!selected.length || selected.includes('ALL')) {
    return STRATEGY_LIBRARY.map((item) => item.key);
  }
  return STRATEGY_LIBRARY.map((item) => item.key).filter((key) => selected.includes(key.toUpperCase()) || selected.includes(key));
}

function pickCodeFromMessage(message) {
  const matched = String(message || '').match(/(hk\d{5}|\d{6}|[A-Za-z]{2,6})/g);
  if (!matched) return null;
  const preferred = matched.find((item) => /^(hk\d{5}|\d{6}|[A-Za-z]{2,6})$/i.test(item));
  return preferred ? normalizeStockCode(preferred) : null;
}

function buildAgentReply({ message, code, quote, strategies }) {
  const strategyText = strategies.length
    ? `策略视角：${strategies.join('、')}`
    : '策略视角：默认趋势+量价模型';

  if (!quote) {
    return `收到你的问题：“${message}”。\n\n暂未识别到可分析的股票代码，请在问题里附上如 600519 / 00700 / AAPL。`;
  }

  const trend = quote.ma5 && quote.ma10 && quote.ma20 && quote.ma5 > quote.ma10 && quote.ma10 > quote.ma20;
  const signal = trend ? '偏多（趋势完整）' : '中性（等待确认）';
  const action = trend ? '可分批回踩介入，止损遵守 5%-7% 原则。' : '建议耐心等待放量突破或均线再走强后再决策。';

  return `你问的是 ${code}。\n\n当前价格 ${quote.price}，涨跌 ${quote.changePct}% ，MA5/10/20 = ${quote.ma5 || '-'} / ${quote.ma10 || '-'} / ${quote.ma20 || '-'}。\n` +
    `结论：${signal}。${action}\n\n${strategyText}\n\n仅供参考，不构成投资建议。`;
}

export const agentService = {
  getModels() {
    return AGENT_MODELS;
  },

  getStrategies() {
    const enabled = new Set(getEnabledSkills());
    return STRATEGY_LIBRARY.map((item) => ({
      ...item,
      enabled: enabled.has(item.key),
    }));
  },

  async chat({ message, sessionId, userId, strategies }) {
    if (!message) throw new HttpError(400, 'message 不能为空');

    const resolvedSessionId = sessionId || randomUUID();
    const selectedStrategies = Array.isArray(strategies) && strategies.length ? strategies : getEnabledSkills();

    chatRepository.ensureSession({
      sessionId: resolvedSessionId,
      userId: userId || 'web',
      title: String(message).slice(0, 30),
    });

    chatRepository.createMessage({
      sessionId: resolvedSessionId,
      role: 'user',
      content: message,
      metadata: { selectedStrategies },
    });

    const code = pickCodeFromMessage(message);
    let quote = null;
    if (code) {
      try {
        quote = await stockDataService.getQuote(code);
      } catch {
        quote = null;
      }
    }

    const reply = buildAgentReply({
      message,
      code,
      quote,
      strategies: selectedStrategies,
    });

    chatRepository.createMessage({
      sessionId: resolvedSessionId,
      role: 'assistant',
      content: reply,
      metadata: { code: code || null },
    });

    return {
      sessionId: resolvedSessionId,
      message: reply,
      code: code || null,
      quote,
      strategies: selectedStrategies,
    };
  },

  listSessions({ limit = 50, userId }) {
    return chatRepository.listSessions({ limit, userId });
  },

  getSessionMessages(sessionId, limit = 100) {
    return chatRepository.listMessages(sessionId, limit);
  },

  deleteSession(sessionId) {
    const deleted = chatRepository.deleteSession(sessionId);
    return { deleted };
  },
};

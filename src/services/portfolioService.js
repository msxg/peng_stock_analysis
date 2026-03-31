import { portfolioRepository } from '../repositories/portfolioRepository.js';
import { stockDataService } from './stockDataService.js';
import { normalizeStockCode } from '../utils/stockCode.js';
import { HttpError } from '../utils/httpError.js';

function computeHoldings(trades) {
  const map = new Map();

  trades
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
    .forEach((trade) => {
      const code = normalizeStockCode(trade.stockCode);
      if (!map.has(code)) {
        map.set(code, {
          stockCode: code,
          market: trade.market,
          quantity: 0,
          totalCost: 0,
          buyAmount: 0,
          sellAmount: 0,
          fees: 0,
        });
      }

      const position = map.get(code);
      const qty = Number(trade.quantity);
      const amount = Number(trade.price) * qty;
      const fee = Number(trade.fee || 0);
      position.fees += fee;

      if (trade.side.toLowerCase() === 'buy') {
        position.quantity += qty;
        position.totalCost += amount + fee;
        position.buyAmount += amount;
      } else {
        const avgCost = position.quantity > 0 ? position.totalCost / position.quantity : trade.price;
        position.quantity -= qty;
        position.totalCost -= avgCost * qty;
        position.sellAmount += amount;
        if (position.quantity < 0.000001) {
          position.quantity = 0;
          position.totalCost = 0;
        }
      }
    });

  return Array.from(map.values());
}

async function attachQuotes(holdings) {
  return Promise.all(
    holdings.map(async (item) => {
      if (item.quantity <= 0) return null;
      let quote = null;
      try {
        quote = await stockDataService.getQuote(item.stockCode);
      } catch {
        quote = { price: 0, changePct: 0 };
      }

      const avgCost = item.quantity > 0 ? item.totalCost / item.quantity : 0;
      const marketValue = Number((item.quantity * quote.price).toFixed(2));
      const costValue = Number((item.quantity * avgCost).toFixed(2));
      const pnl = Number((marketValue - costValue).toFixed(2));
      const pnlPct = costValue ? Number(((pnl / costValue) * 100).toFixed(2)) : 0;

      return {
        stockCode: item.stockCode,
        market: item.market,
        quantity: Number(item.quantity.toFixed(4)),
        avgCost: Number(avgCost.toFixed(4)),
        lastPrice: quote.price,
        changePct: quote.changePct,
        marketValue,
        costValue,
        pnl,
        pnlPct,
      };
    }),
  ).then((items) => items.filter(Boolean));
}

export const portfolioService = {
  createAccount(payload) {
    if (!payload?.name) throw new HttpError(400, '账户名称不能为空');
    return portfolioRepository.createAccount(payload);
  },

  listAccounts() {
    return portfolioRepository.listAccounts();
  },

  updateAccount(accountId, payload) {
    const updated = portfolioRepository.updateAccount(accountId, payload);
    if (!updated) throw new HttpError(404, '账户不存在');
    return updated;
  },

  deleteAccount(accountId) {
    const deleted = portfolioRepository.deleteAccount(accountId);
    if (!deleted) throw new HttpError(404, '账户不存在');
    return { deleted };
  },

  createTrade(payload) {
    if (!payload.accountId || !payload.stockCode || !payload.side || !payload.quantity || !payload.price || !payload.tradeDate) {
      throw new HttpError(400, '交易参数不完整');
    }

    return portfolioRepository.createTrade({
      ...payload,
      stockCode: normalizeStockCode(payload.stockCode),
    });
  },

  listTrades(params) {
    return portfolioRepository.listTrades(params || {});
  },

  createCashLedger(payload) {
    if (!payload.accountId || !payload.type || !payload.amount || !payload.occurredAt) {
      throw new HttpError(400, '现金流水参数不完整');
    }
    return portfolioRepository.createCashLedger(payload);
  },

  listCashLedger(params) {
    return portfolioRepository.listCashLedger(params || {});
  },

  createCorporateAction(payload) {
    if (!payload.accountId || !payload.stockCode || !payload.actionType || !payload.effectiveDate) {
      throw new HttpError(400, '公司行为参数不完整');
    }
    return portfolioRepository.createCorporateAction({
      ...payload,
      stockCode: normalizeStockCode(payload.stockCode),
    });
  },

  listCorporateActions(params) {
    return portfolioRepository.listCorporateActions(params || {});
  },

  async getSnapshot({ accountId }) {
    const trades = portfolioRepository.listTrades({ accountId, limit: 2000 });
    const ledgers = portfolioRepository.listCashLedger({ accountId, limit: 2000 });

    const holdings = computeHoldings(trades);
    const positions = await attachQuotes(holdings);

    const totalMarketValue = Number(positions.reduce((sum, item) => sum + item.marketValue, 0).toFixed(2));
    const totalCostValue = Number(positions.reduce((sum, item) => sum + item.costValue, 0).toFixed(2));

    const cashBalance = Number(ledgers.reduce((sum, item) => {
      if (item.type === 'deposit' || item.type === 'dividend') return sum + Number(item.amount);
      return sum - Number(item.amount);
    }, 0).toFixed(2));

    const totalAsset = Number((totalMarketValue + cashBalance).toFixed(2));
    const totalPnl = Number((totalMarketValue - totalCostValue).toFixed(2));

    return {
      accountId: accountId || null,
      asOf: new Date().toISOString(),
      summary: {
        totalAsset,
        totalMarketValue,
        totalCostValue,
        cashBalance,
        totalPnl,
        totalPnlPct: totalCostValue ? Number(((totalPnl / totalCostValue) * 100).toFixed(2)) : 0,
      },
      positions,
      cashLedgerCount: ledgers.length,
      tradeCount: trades.length,
    };
  },

  async getRiskReport({ accountId }) {
    const snapshot = await this.getSnapshot({ accountId });
    const total = snapshot.summary.totalMarketValue || 1;
    const weights = snapshot.positions.map((item) => ({
      stockCode: item.stockCode,
      weight: Number(((item.marketValue / total) * 100).toFixed(2)),
      pnlPct: item.pnlPct,
    })).sort((a, b) => b.weight - a.weight);

    const topWeight = weights[0]?.weight || 0;
    const lossPositions = snapshot.positions.filter((item) => item.pnl < 0).length;

    return {
      accountId: accountId || null,
      concentrationRisk: topWeight >= 35 ? 'high' : topWeight >= 20 ? 'medium' : 'low',
      topPositionWeight: topWeight,
      cashRatio: snapshot.summary.totalAsset
        ? Number(((snapshot.summary.cashBalance / snapshot.summary.totalAsset) * 100).toFixed(2))
        : 0,
      lossPositionRatio: snapshot.positions.length
        ? Number(((lossPositions / snapshot.positions.length) * 100).toFixed(2))
        : 0,
      positionWeights: weights,
      generatedAt: new Date().toISOString(),
    };
  },
};

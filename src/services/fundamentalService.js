import { normalizeStockCode } from '../utils/stockCode.js';

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function seededFromCode(code) {
  const text = normalizeStockCode(code);
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) + 1;
}

function pickBoardByCode(code) {
  const boards = ['能源', '消费', '半导体', '医药', '军工', '券商', 'AI算力', '汽车', '电池', '黄金'];
  const seed = seededFromCode(code);
  return [boards[seed % boards.length], boards[(seed + 3) % boards.length]];
}

function buildBoardRankings(seed) {
  const pool = [
    { name: 'AI算力', changePct: 2.8 },
    { name: '机器人', changePct: 1.9 },
    { name: '创新药', changePct: 1.5 },
    { name: '中特估', changePct: -0.6 },
    { name: '光伏', changePct: -1.1 },
    { name: '地产链', changePct: -1.8 },
  ];

  const drift = (seed % 7) / 10;
  const adjusted = pool.map((item, idx) => ({
    ...item,
    changePct: Number((item.changePct + (idx % 2 === 0 ? drift : -drift)).toFixed(2)),
  }));

  const sorted = adjusted.sort((a, b) => b.changePct - a.changePct);
  return {
    top: sorted.slice(0, 3),
    bottom: sorted.slice(-3).reverse(),
  };
}

function safeSection(factory) {
  try {
    return { status: 'ok', ...factory() };
  } catch (error) {
    return { status: 'degraded', data: null, error: error.message };
  }
}

export const fundamentalService = {
  async buildFundamentalContext({ stockCode, quote, history }) {
    const code = normalizeStockCode(stockCode);
    const seed = seededFromCode(code);
    const latest = history[history.length - 1] || {};
    const prev20 = history[Math.max(0, history.length - 20)] || latest;
    const momentum20 = prev20.close
      ? ((safeNumber(latest.close) - safeNumber(prev20.close)) / safeNumber(prev20.close)) * 100
      : 0;

    const context = {
      valuation: safeSection(() => {
        const epsEst = Math.max(0.1, quote.price / (8 + (seed % 18)));
        const peTtm = Number((quote.price / epsEst).toFixed(2));
        const pb = Number((1.1 + (seed % 30) / 10).toFixed(2));
        const ps = Number((1 + (seed % 22) / 10).toFixed(2));
        const band = peTtm < 15 ? '低估区' : peTtm > 30 ? '高估区' : '中性区';
        return {
          source: 'heuristic',
          data: {
            pe_ttm: peTtm,
            pb,
            ps,
            valuation_band: band,
          },
        };
      }),
      growth: safeSection(() => {
        return {
          source: 'heuristic',
          data: {
            revenue_yoy: Number((momentum20 * 1.8).toFixed(2)),
            profit_yoy: Number((momentum20 * 1.2).toFixed(2)),
            eps_growth: Number((momentum20 * 0.9).toFixed(2)),
          },
        };
      }),
      earnings: safeSection(() => {
        const netProfit = Number((quote.price * (200 + (seed % 500)) * 10000).toFixed(0));
        const dividendYield = Number((0.8 + (seed % 40) / 10).toFixed(2));
        return {
          source: 'heuristic',
          data: {
            financial_report: {
              latest_quarter: '2025Q4',
              revenue: Number((netProfit * 4.5).toFixed(0)),
              net_profit: netProfit,
              gross_margin: Number((22 + (seed % 18)).toFixed(2)),
            },
            dividend: {
              cash_dividend_per_share: Number((0.1 + (seed % 30) / 100).toFixed(2)),
              dividend_yield: dividendYield,
              payout_ratio: Number((20 + (seed % 50)).toFixed(2)),
            },
          },
        };
      }),
      institution: safeSection(() => {
        return {
          source: 'heuristic',
          data: {
            institution_holding_ratio: Number((15 + (seed % 55)).toFixed(2)),
            recent_institution_action: seed % 2 === 0 ? '增持' : '减持',
            northbound_position_change: Number((((seed % 100) - 50) / 10).toFixed(2)),
          },
        };
      }),
      capital_flow: safeSection(() => {
        const mainInflow = Number(((quote.volumeRatio - 1) * quote.price * 900000).toFixed(0));
        return {
          source: 'heuristic',
          data: {
            main_fund_inflow: mainInflow,
            super_large_order_ratio: Number((8 + (seed % 25)).toFixed(2)),
            turnover_acceleration: Number((quote.volumeRatio * 100).toFixed(2)),
          },
        };
      }),
      dragon_tiger: safeSection(() => {
        const onList = quote.volumeRatio > 2.2 && Math.abs(quote.changePct) > 2.5;
        return {
          source: 'heuristic',
          data: {
            on_list: onList,
            reason: onList ? '量价显著异动，达到龙虎榜特征阈值' : '未达到龙虎榜特征阈值',
          },
        };
      }),
      boards: safeSection(() => {
        return {
          source: 'heuristic',
          data: {
            belong_boards: pickBoardByCode(code),
            sector_rankings: buildBoardRankings(seed),
          },
        };
      }),
    };

    return {
      fail_open: true,
      generated_at: new Date().toISOString(),
      ...context,
    };
  },
};

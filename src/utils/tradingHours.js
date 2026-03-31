function upperText(value) {
  return String(value || '').trim().toUpperCase();
}

function extractFuturesPrefix(value) {
  const text = upperText(value).replace(/^\d{2,3}[._-]?/, '');
  const match = text.match(/^[A-Z]+/);
  return match ? match[0] : '';
}

const EXTERNAL_FUTURES_MARKETS = new Set([101, 102, 103, 104, 108, 110, 112]);
const DOMESTIC_FUTURES_EXCHANGE_PATTERN = /(SHFE|INE|CFFEX|DCE|CZCE|GFEX|上期所|上期能源|中金所|大商所|郑商所|广期所)/i;

// Official references used for the mappings below:
// - SHFE trading hours: https://www.shfe.com.cn/services/calenderandholidays/tradinghours/
// - GFEX product pages, e.g. 碳酸锂: https://www.gfex.com.cn/gfex/tsl/sspz.shtml
// - CFFEX product pages, e.g. 沪深300股指期货: https://www.cffex.com.cn/hs300/
// - CZCE business rules pages, e.g. 棉花/甲醇/纯碱/尿素等品种业务细则
// - SSE / SZSE / BSE auction rules and trading hours, HKEX securities trading hours,
//   and NYSE / Nasdaq regular market hours.

const OFFICIAL_STOCK_TRADING_HOURS = {
  A: '开盘集合竞价 09:15-09:25 / 连续竞价 09:30-11:30、13:00-14:57 / 收盘集合竞价 14:57-15:00',
  SH: '开盘集合竞价 09:15-09:25 / 连续竞价 09:30-11:30、13:00-14:57 / 收盘集合竞价 14:57-15:00',
  SZ: '开盘集合竞价 09:15-09:25 / 连续竞价 09:30-11:30、13:00-14:57 / 收盘集合竞价 14:57-15:00',
  BJ: '开盘集合竞价 09:15-09:25 / 连续竞价 09:30-11:30、13:00-14:57 / 收盘集合竞价 14:57-15:00',
  HK: '开市前时段 09:00-09:30 / 持续交易时段 09:30-12:00、13:00-16:00 / 收市竞价时段 16:00-16:08 至 16:10（随机收市）',
  GEM: '开市前时段 09:00-09:30 / 持续交易时段 09:30-12:00、13:00-16:00 / 收市竞价时段 16:00-16:08 至 16:10（随机收市）',
  US: '常规交易时段（美东时间）09:30-16:00',
  NASDAQ: '常规交易时段（美东时间）09:30-16:00',
  NYSE: '常规交易时段（美东时间）09:30-16:00',
  AMEX: '常规交易时段（美东时间）09:30-16:00',
  NYSEMKT: '常规交易时段（美东时间）09:30-16:00',
  NYSEARCA: '常规交易时段（美东时间）09:30-16:00',
};

const OFFICIAL_FUTURES_EXACT_TRADING_HOURS = {
  TF2: '09:30-11:30 / 13:00-15:15（最后交易日 09:30-11:30）',
  TS: '09:30-11:30 / 13:00-15:15（最后交易日 09:30-11:30）',
};

const OFFICIAL_FUTURES_TRADING_HOURS = {
  AU: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-02:30',
  AG: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-02:30',
  SC: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-02:30',
  CU: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-01:00',
  BC: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-01:00',
  AL: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-01:00',
  AO: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-01:00',
  ZN: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-01:00',
  PB: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-01:00',
  NI: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-01:00',
  SN: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-01:00',
  SS: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-01:00',
  AD: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-01:00',
  RB: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  HC: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  FU: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  BU: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  RU: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  BR: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  SP: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  OP: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  NR: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  LU: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  WR: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00',
  EC: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00',
  LC: '上午 09:00-11:30，下午 13:30-15:00，以及交易所规定的其他时间；日盘分三小节：09:00-10:15 / 10:30-11:30 / 13:30-15:00',
  SI: '上午 09:00-11:30，下午 13:30-15:00，以及交易所规定的其他时间；日盘分三小节：09:00-10:15 / 10:30-11:30 / 13:30-15:00',
  PS: '上午 09:00-11:30，下午 13:30-15:00，以及交易所规定的其他时间；日盘分三小节：09:00-10:15 / 10:30-11:30 / 13:30-15:00',
  AP: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00',
  CJ: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00',
  JR: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00',
  LR: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00',
  PK: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00',
  PM: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00',
  RI: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00',
  RS: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00',
  SF: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00',
  SM: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00',
  UR: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00',
  WH: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00',
  CF: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  CY: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  FG: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  MA: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  OI: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  PF: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  PL: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  PX: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  PR: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  RM: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  SA: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  SH: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  SR: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  TA: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  ZC: '日盘 09:00-10:15 / 10:30-11:30 / 13:30-15:00；夜盘 21:00-23:00',
  IF: '上午 09:30-11:30，下午 13:00-15:00',
  IH: '上午 09:30-11:30，下午 13:00-15:00',
  IC: '上午 09:30-11:30，下午 13:00-15:00',
  IM: '上午 09:30-11:30，下午 13:00-15:00',
  TF: '09:30-11:30 / 13:00-15:15（最后交易日 09:30-11:30）',
  T: '09:30-11:30 / 13:00-15:15（最后交易日 09:30-11:30）',
  TS: '09:30-11:30 / 13:00-15:15（最后交易日 09:30-11:30）',
  TL: '09:30-11:30 / 13:00-15:15（最后交易日 09:30-11:30）',
};

export function getOfficialStockTradingHours({ market = '', subMarket = '' } = {}) {
  const normalizedSubMarket = upperText(subMarket);
  if (normalizedSubMarket && OFFICIAL_STOCK_TRADING_HOURS[normalizedSubMarket]) {
    return OFFICIAL_STOCK_TRADING_HOURS[normalizedSubMarket];
  }

  const normalizedMarket = upperText(market);
  if (OFFICIAL_STOCK_TRADING_HOURS[normalizedMarket]) {
    return OFFICIAL_STOCK_TRADING_HOURS[normalizedMarket];
  }

  return null;
}

export function getOfficialFuturesTradingHours({
  quoteCode = '',
  code = '',
  market = null,
  exchange = '',
} = {}) {
  const normalizedExchange = String(exchange || '').trim();
  const marketNum = Number(market);
  const normalizedCode = upperText(code);
  const normalizedQuoteCode = upperText(quoteCode);

  const isDomestic = (
    DOMESTIC_FUTURES_EXCHANGE_PATTERN.test(normalizedExchange)
    || (Number.isFinite(marketNum) && !EXTERNAL_FUTURES_MARKETS.has(marketNum))
    || (!normalizedQuoteCode.includes('.') && Boolean(normalizedQuoteCode))
    || (!/00Y$/.test(normalizedCode) && /^[A-Z]+\d{3,4}$/.test(normalizedCode))
  );

  if (!isDomestic) return null;

  const rawCandidates = [
    code,
    quoteCode,
    String(code || '').split('.').pop(),
    String(quoteCode || '').split('.').pop(),
  ];

  const normalizedCandidates = Array.from(new Set(
    rawCandidates
      .map((item) => upperText(item))
      .filter(Boolean),
  ));

  for (const item of normalizedCandidates) {
    if (OFFICIAL_FUTURES_EXACT_TRADING_HOURS[item]) {
      return OFFICIAL_FUTURES_EXACT_TRADING_HOURS[item];
    }
  }

  for (const item of normalizedCandidates) {
    const prefix = extractFuturesPrefix(item);
    if (prefix && OFFICIAL_FUTURES_TRADING_HOURS[prefix]) {
      return OFFICIAL_FUTURES_TRADING_HOURS[prefix];
    }
  }

  return null;
}

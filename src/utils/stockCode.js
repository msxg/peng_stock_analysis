const US_INDEX_MAP = {
  SPX: '^GSPC',
  GSPC: '^GSPC',
  DJI: '^DJI',
  IXIC: '^IXIC',
  NDX: '^NDX',
};

export function normalizeStockCode(input) {
  if (!input) return '';
  const raw = String(input).trim().toUpperCase().replace(/\s+/g, '');
  if (!raw) return '';

  let match = raw.match(/^(\d{6})\.(SH|SZ)$/);
  if (match) {
    return `${match[2]}${match[1]}`;
  }

  match = raw.match(/^(SH|SZ)\.?(\d{6})$/);
  if (match) {
    return `${match[1]}${match[2]}`;
  }

  match = raw.match(/^(\d{5})\.HK$/);
  if (match) {
    return `HK${match[1]}`;
  }

  match = raw.match(/^HK\.?(\d{5})$/);
  if (match) {
    return `HK${match[1]}`;
  }

  return raw;
}

export function inferMarket(code) {
  const normalized = normalizeStockCode(code);
  if (/^SH\d{6}$/.test(normalized)) return 'CN_SH';
  if (/^SZ\d{6}$/.test(normalized)) return 'CN_SZ';
  if (normalized.startsWith('HK') || /^\d{5}$/.test(normalized)) return 'HK';
  if (/^\d{6}$/.test(normalized)) return normalized.startsWith('6') ? 'CN_SH' : 'CN_SZ';
  if (US_INDEX_MAP[normalized]) return 'US_INDEX';
  if (/^[A-Z.\-^]{1,10}$/.test(normalized)) return 'US';
  return 'UNKNOWN';
}

export function toYahooSymbol(code) {
  const normalized = normalizeStockCode(code);
  if (US_INDEX_MAP[normalized]) return US_INDEX_MAP[normalized];

  const shMatch = normalized.match(/^SH(\d{6})$/);
  if (shMatch) {
    return `${shMatch[1]}.SS`;
  }

  const szMatch = normalized.match(/^SZ(\d{6})$/);
  if (szMatch) {
    return `${szMatch[1]}.SZ`;
  }

  if (normalized.startsWith('HK')) {
    const digits = normalized.replace('HK', '').padStart(5, '0');
    return `${digits}.HK`;
  }

  if (/^\d{5}$/.test(normalized)) {
    return `${normalized}.HK`;
  }

  if (/^\d{6}$/.test(normalized)) {
    if (normalized.startsWith('6') || normalized.startsWith('9') || normalized.startsWith('5')) {
      return `${normalized}.SS`;
    }
    return `${normalized}.SZ`;
  }

  return normalized;
}

export function parseStockList(text) {
  if (!text) return [];
  return Array.from(
    new Set(
      String(text)
        .split(/[\n,;，；\s]+/)
        .map((item) => normalizeStockCode(item))
        .filter(Boolean),
    ),
  );
}

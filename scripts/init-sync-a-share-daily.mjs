import { marketDataService } from '../src/services/marketDataService.js';

function parseArgValue(name, fallback = '') {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => String(item || '').startsWith(prefix));
  if (!hit) return fallback;
  return String(hit).slice(prefix.length).trim() || fallback;
}

async function main() {
  const startDay = parseArgValue('start', '1990-12-19');
  const mode = parseArgValue('mode', 'from_trade_day_to_now');

  const payload = {
    symbolType: 'stock',
    timeframe: '1d',
    tradeDay: startDay,
    syncRange: mode === 'single_day' ? 'single_day' : 'from_trade_day_to_now',
  };

  console.log('[init-sync-a-share-daily] start', new Date().toISOString(), payload);
  const result = await marketDataService.syncMarketData(payload);
  console.log('[init-sync-a-share-daily] done', new Date().toISOString(), {
    jobId: result.jobId,
    symbolTotal: result.symbolTotal,
    successSymbols: result.successSymbols,
    failedSymbols: result.failedSymbols,
    writtenBars: result.writtenBars,
    startDay: result.startDay,
    endDay: result.endDay,
    firstSyncedDay: result.firstSyncedDay,
    lastSyncedDay: result.lastSyncedDay,
  });
}

main().catch((error) => {
  console.error('[init-sync-a-share-daily] failed', error?.message || error);
  process.exitCode = 1;
});

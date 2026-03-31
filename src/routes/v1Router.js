import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authController } from '../controllers/authController.js';
import { analysisController } from '../controllers/analysisController.js';
import { historyController } from '../controllers/historyController.js';
import { stocksController } from '../controllers/stocksController.js';
import { backtestController } from '../controllers/backtestController.js';
import { systemController } from '../controllers/systemController.js';
import { usageController } from '../controllers/usageController.js';
import { portfolioController } from '../controllers/portfolioController.js';
import { agentController } from '../controllers/agentController.js';
import { healthController } from '../controllers/healthController.js';
import { marketController } from '../controllers/marketController.js';
import { futuresController } from '../controllers/futuresController.js';
import { stockBasicsController } from '../controllers/stockBasicsController.js';
import { stockMonitorController } from '../controllers/stockMonitorController.js';
import { marketDataController } from '../controllers/marketDataController.js';
import { focusNewsController } from '../controllers/focusNewsController.js';

const upload = multer({ dest: 'tmp/uploads' });
const router = Router();

router.get('/health', healthController.check);

router.get('/auth/status', authController.status);
router.post('/auth/login', authController.login);
router.post('/auth/logout', authController.logout);
router.post('/auth/settings', authController.updateSettings);
router.post('/auth/change-password', authController.changePassword);

router.post('/analysis', asyncHandler(analysisController.trigger));
router.get('/analysis/tasks', analysisController.listTasks);
router.get('/analysis/tasks/stream', analysisController.stream);
router.get('/analysis/tasks/:taskId', analysisController.getStatus);

router.get('/history', historyController.list);
router.delete('/history', historyController.deleteBatch);
router.get('/history/:id', historyController.detail);
router.get('/history/:id/news', historyController.news);
router.get('/history/:id/markdown', historyController.markdown);

router.get('/stocks/:stockCode/quote', asyncHandler(stocksController.quote));
router.get('/stocks/:stockCode/history', asyncHandler(stocksController.history));
router.post('/stocks/parse-import', upload.single('file'), asyncHandler(stocksController.parseImport));
router.post('/stocks/extract-from-image', upload.single('file'), asyncHandler(stocksController.extractFromImage));
router.post('/stock-basics/sync', asyncHandler(stockBasicsController.sync));
router.get('/stock-basics', stockBasicsController.search);
router.get('/stock-basics/suggest', asyncHandler(stockBasicsController.suggest));
router.get('/stock-basics/:code', asyncHandler(stockBasicsController.detail));

router.get('/market/review', asyncHandler(marketController.review));

router.get('/focus-news/providers', focusNewsController.providers);
router.get('/focus-news/categories', focusNewsController.categories);
router.get('/focus-news/taxonomies', focusNewsController.taxonomies);
router.get('/focus-news/mappings', focusNewsController.mappings);
router.get('/focus-news/sync/runs', focusNewsController.runs);
router.get('/focus-news/scheduler/status', focusNewsController.schedulerStatus);
router.get('/focus-news/scheduler/categories', focusNewsController.schedulerCategories);
router.get('/focus-news/items', focusNewsController.items);
router.get('/focus-news/items/:newsUid', focusNewsController.itemDetail);
router.post('/focus-news/sync/catalog', asyncHandler(focusNewsController.syncCatalog));
router.post('/focus-news/sync/items', asyncHandler(focusNewsController.syncItems));
router.post('/focus-news/scheduler/categories/:categoryKey/policy', focusNewsController.schedulerCategoryPolicy);
router.post('/focus-news/scheduler/run', asyncHandler(focusNewsController.schedulerRun));

router.get('/futures/timeframes', futuresController.timeframes);
router.get('/futures/presets', asyncHandler(futuresController.presets));
router.get('/futures/resolve', asyncHandler(futuresController.resolve));
router.get('/futures/categories', futuresController.listCategories);
router.post('/futures/categories', futuresController.createCategory);
router.put('/futures/categories/:categoryId', futuresController.updateCategory);
router.delete('/futures/categories/:categoryId', futuresController.deleteCategory);
router.post('/futures/symbols', asyncHandler(futuresController.createSymbol));
router.delete('/futures/symbols/:symbolId', futuresController.deleteSymbol);
router.get('/futures/monitor', asyncHandler(futuresController.monitor));

router.get('/stock-monitor/timeframes', stockMonitorController.timeframes);
router.get('/stock-monitor/categories', stockMonitorController.listCategories);
router.post('/stock-monitor/categories', stockMonitorController.createCategory);
router.put('/stock-monitor/categories/:categoryId', stockMonitorController.updateCategory);
router.delete('/stock-monitor/categories/:categoryId', stockMonitorController.deleteCategory);
router.post('/stock-monitor/categories/:categoryId/move', stockMonitorController.moveCategory);
router.post('/stock-monitor/symbols', asyncHandler(stockMonitorController.createSymbol));
router.post('/stock-monitor/symbols/:symbolId/move', stockMonitorController.moveSymbol);
router.delete('/stock-monitor/symbols/:symbolId', stockMonitorController.deleteSymbol);
router.get('/stock-monitor/monitor', asyncHandler(stockMonitorController.monitor));

router.post('/backtest/run', asyncHandler(backtestController.run));
router.get('/backtest/results', backtestController.list);
router.get('/backtest/overall-performance', backtestController.overall);
router.get('/backtest/stock-performance', backtestController.byStock);

router.get('/system/config', systemController.getConfig);
router.put('/system/config', systemController.updateConfig);
router.post('/system/validate', systemController.validateConfig);
router.post('/system/test-llm', systemController.testLlmChannel);
router.post('/system/test-email', asyncHandler(systemController.testEmail));
router.get('/system/schema', systemController.getSchema);
router.get('/system/market-data', marketDataController.futuresIntraday);
router.post('/system/market-data/sync', asyncHandler(marketDataController.syncFuturesIntraday));

router.get('/usage/summary', usageController.summary);

router.post('/portfolio/accounts', portfolioController.createAccount);
router.get('/portfolio/accounts', portfolioController.listAccounts);
router.put('/portfolio/accounts/:accountId', portfolioController.updateAccount);
router.delete('/portfolio/accounts/:accountId', portfolioController.deleteAccount);

router.post('/portfolio/trades', portfolioController.createTrade);
router.get('/portfolio/trades', portfolioController.listTrades);

router.post('/portfolio/cash-ledger', portfolioController.createCashLedger);
router.get('/portfolio/cash-ledger', portfolioController.listCashLedger);

router.post('/portfolio/corporate-actions', portfolioController.createCorporateAction);
router.get('/portfolio/corporate-actions', portfolioController.listCorporateActions);

router.get('/portfolio/snapshot', asyncHandler(portfolioController.snapshot));
router.get('/portfolio/risk-report', asyncHandler(portfolioController.riskReport));

router.get('/agent/models', agentController.models);
router.get('/agent/strategies', agentController.strategies);
router.post('/agent/chat', asyncHandler(agentController.chat));
router.post('/agent/chat/stream', asyncHandler(agentController.chatStream));
router.post('/agent/chat/send', asyncHandler(agentController.sendToNotification));
router.get('/agent/chat/sessions', agentController.listSessions);
router.get('/agent/chat/sessions/:sessionId', agentController.sessionMessages);
router.delete('/agent/chat/sessions/:sessionId', agentController.deleteSession);

export default router;

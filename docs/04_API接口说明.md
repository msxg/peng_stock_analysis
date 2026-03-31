# API 接口说明

基础前缀：`/api/v1`

## 1. 认证

- `GET /auth/status`
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/settings`
- `POST /auth/change-password`

## 2. 分析

- `POST /analysis`
  - 请求示例：
  ```json
  {
    "stockList": "600519,00700,AAPL",
    "async": false
  }
  ```
  - 同步响应核心字段：
  ```json
  {
    "mode": "sync",
    "items": [
      {
        "stockCode": "AAPL",
        "summary": "...",
        "recommendation": "...",
        "buyPrice": 123.45,
        "stopLoss": 117.28,
        "targetPrice": 135.79,
        "technical": {
          "quote": {},
          "latestCandles": [],
          "volumeProfile": [],
          "checklist": [],
          "extended": {
            "sentiment": {},
            "fundamental_context": {},
            "strategy": {},
            "market_review": {}
          }
        },
        "news": []
      }
    ]
  }
  ```
- `GET /analysis/tasks`
- `GET /analysis/tasks/:taskId`
- `GET /analysis/tasks/stream` (SSE)

## 3. 市场复盘

- `GET /market/review?region=cn|us|both`

## 4. 焦点资讯（一期底座）

- `GET /focus-news/providers`
- `GET /focus-news/categories?providerKey=tushare`
- `GET /focus-news/taxonomies`
- `GET /focus-news/mappings?providerKey=tushare`
- `GET /focus-news/sync/runs?providerKey=tushare&limit=20`
- `GET /focus-news/scheduler/status?providerKey=tushare&limit=8`
  - 响应新增关键字段：
  ```json
  {
    "scheduler": {
      "started": true,
      "running": false,
      "schedulerConcurrency": 2,
      "activeCategoryCount": 6,
      "stateRestored": true,
      "stateLoadedAt": "2026-03-25T14:22:00.000Z",
      "statePersistedAt": "2026-03-25 14:22:08",
      "lastTickAt": "2026-03-25T14:22:03.000Z",
      "lastTickResult": {
        "runStatus": "completed",
        "selectedCategoryKey": "major_news",
        "selectedCategoryKeys": ["major_news", "cctv_news"],
        "attemptedCount": 2,
        "completedCount": 2,
        "failedCount": 0,
        "schedulerConcurrency": 2,
        "durationMs": 820
      },
      "retryQueueSize": 1,
      "retries": []
    },
    "recentRuns": []
  }
  ```
- `GET /focus-news/scheduler/categories?providerKey=tushare&level=2`
  - 返回可调度分类及当前策略（启用/优先级）。
- `POST /focus-news/scheduler/categories/:categoryKey/policy`
  ```json
  {
    "providerKey": "tushare",
    "schedulerEnabled": true,
    "schedulerPriority": 30
  }
  ```
- 调度参数配置通过系统配置接口：
  - `PUT /system/config`
  - 常用 key：`NEWS_SYNC_ENABLED`、`NEWS_PROVIDER_TUSHARE_ENABLED`、`NEWS_SYNC_TICK_SECONDS`、`NEWS_SCHEDULER_CONCURRENCY`、`NEWS_SYNC_LOOKBACK_MINUTES`、`NEWS_MAX_ITEMS_PER_RUN`
- `GET /focus-news/items?providerKey=tushare&categoryKey=news&q=关键词&page=1&limit=20`
- `GET /focus-news/items/:newsUid`
- `POST /focus-news/sync/catalog`
  ```json
  {
    "providerKey": "tushare",
    "triggerType": "manual"
  }
  ```
- `POST /focus-news/sync/items`
  ```json
  {
    "providerKey": "tushare",
    "categoryKey": "news",
    "startDate": "2026-03-25",
    "endDate": "2026-03-25",
    "limit": 500,
    "newsSources": "sina,cls,eastmoney",
    "triggerType": "manual"
  }
  ```
  - `newsSources`：仅 `categoryKey=news` 时可选，逗号分隔网页资讯源（用于 Cookie 抓取兜底）。
  - `triggerType` 支持 `manual|scheduler`，调度器运行会写入 `scheduler`。
- `POST /focus-news/scheduler/run`
  ```json
  {
    "providerKey": "tushare",
    "limit": 8
  }
  ```

## 5. 历史

- `GET /history?page=1&limit=20`
- `GET /history/:id`
- `GET /history/:id/markdown`
- `DELETE /history`
  ```json
  { "recordIds": [1, 2, 3] }
  ```

## 6. 有色期货监测

- `GET /futures/timeframes`
- `GET /futures/presets`（动态预设品种，支持 `?force=1` 强制刷新缓存）
- `GET /futures/categories`
- `POST /futures/categories`
  ```json
  { "name": "贵金属", "description": "有色核心观察池" }
  ```
- `POST /futures/symbols`
  ```json
  { "categoryId": 1, "name": "白银主连", "quoteCode": "101.SI00Y" }
  ```
- `DELETE /futures/symbols/:symbolId`
- `GET /futures/monitor?timeframe=60m&limit=120`
  - 响应核心字段：
  ```json
  {
    "timeframe": "60m",
    "timeframeLabel": "60分钟",
    "total": 1,
    "success": 1,
    "failed": 0,
    "items": [
      {
        "categoryName": "有色金属",
        "name": "白银主连",
        "quoteCode": "101.SI00Y",
        "candleDataSource": "eastmoney.push2his | eastmoney.futsseapi.mx",
        "warning": "K线接口不可用时的降级提示",
        "quote": {
          "price": 80.62,
          "changePct": 3.52,
          "openInterest": 76374,
          "volume": 12345
        },
        "candles": [
          { "date": "2026-03-17 14:30", "open": 80.1, "high": 80.8, "low": 79.9, "close": 80.62, "volume": 5800 }
        ],
        "error": null
      }
    ],
    "failOpen": true
  }
  ```
  - 代码说明：
    - 推荐使用标准 `QuoteID` 形式，如 `101.GC00Y`、`142.sc2605`
    - 系统会对常见名称做自动映射（如“黄金”->`101.GC00Y`）

## 7. 股票与导入

- `GET /stocks/:stockCode/quote`
- `GET /stocks/:stockCode/history?days=180`
- `POST /stocks/parse-import`（支持 multipart 文件上传）
- `POST /stocks/extract-from-image`
- `POST /stock-basics/sync`
  - A股同步会自动执行批量补全（行业/上市时间/主营业务/营业范围/股本与市值），返回 `aFundamentals.quality` 覆盖率统计。
- `GET /stock-basics?market=A|HK|US&q=关键词&page=1&limit=80`
- `GET /stock-basics/:code?market=A|HK|US&localOnly=1`
  - `localOnly=1`：仅查询本地数据库（不触发第三方行情/资料接口），用于详情秒开。
  - `localOnly=0` 或不传：允许 fail-open 拉取远程行情/资料并回写本地。
  - 详情新增字段（用于本地化基础信息）：
  ```json
  {
    "code": "000002",
    "local": {
      "market": "A",
      "code": "000002",
      "name": "万科A",
      "latestPrice": 7.05,
      "totalShares": 11930709471,
      "floatShares": 9716935865,
      "totalMarketCap": 84111501770.55,
      "floatMarketCap": 68504397848.25,
      "industry": "房地产开发",
      "listingDate": "19910129",
      "mainBusiness": "房地产开发及相关资产经营和物业服务",
      "businessScope": "...",
      "companyProfile": "...",
      "fundamentalsSource": "tencent.qt | eastmoney.datacenter.orginfo"
    },
    "fundamentalItems": [
      { "item": "最新", "value": 7.05 },
      { "item": "股票代码", "value": "000002" },
      { "item": "股票简称", "value": "万科A" },
      { "item": "总股本", "value": 11930709471 },
      { "item": "流通股", "value": 9716935865 },
      { "item": "总市值", "value": 84111501770.55 },
      { "item": "流通市值", "value": 68504397848.25 },
      { "item": "行业", "value": "房地产开发" },
      { "item": "上市时间", "value": "19910129" },
      { "item": "主营业务", "value": "..." },
      { "item": "营业范围", "value": "..." }
    ],
    "remoteQuote": {},
    "failOpen": true
  }
  ```

## 8. 回测

- `POST /backtest/run`
  ```json
  { "evaluationDays": 5, "stockCode": "AAPL", "force": true }
  ```
- `GET /backtest/results`
- `GET /backtest/overall-performance`
  - 返回：`directionHitRate/takeProfitHitRate/stopLossHitRate`
- `GET /backtest/stock-performance`
  - 返回：按股票拆分的 `directionHitRate/takeProfitHitRate/stopLossHitRate`

## 9. 持仓

- `POST /portfolio/accounts`
- `GET /portfolio/accounts`
- `PUT /portfolio/accounts/:accountId`
- `DELETE /portfolio/accounts/:accountId`
- `POST /portfolio/trades`
- `GET /portfolio/trades`
- `POST /portfolio/cash-ledger`
- `GET /portfolio/cash-ledger`
- `POST /portfolio/corporate-actions`
- `GET /portfolio/corporate-actions`
- `GET /portfolio/snapshot`
- `GET /portfolio/risk-report`

## 10. Agent

- `GET /agent/models`
- `GET /agent/strategies`
- `POST /agent/chat`
- `POST /agent/chat/stream` (SSE)
- `GET /agent/chat/sessions`
- `GET /agent/chat/sessions/:sessionId`
- `DELETE /agent/chat/sessions/:sessionId`

## 11. 系统

- `GET /system/config`
- `PUT /system/config`
- `POST /system/validate`
- `POST /system/test-llm`
- `POST /system/test-email`
- `GET /system/schema`

## 12. 用量

- `GET /usage/summary?period=7d`

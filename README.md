# Peng Stock Analysis (Next.js + Express API)

基于 `Next.js App Router + Express + SQLite` 的行情分析系统。  
本次重构重点升级了前端架构与性能：RSC、流式渲染、SSR/SEO、Canvas 图表、虚拟化表格。

## 已实现核心模块

- 股票分析：同步/异步任务、任务队列、SSE 任务流
- 历史记录：分页查询、详情查看、批量删除
- 股票数据：行情/历史查询，多源导入（文本/CSV/Excel/图片文件名兜底）
- 回测验证：按评估窗口回测，输出总体/分股票统计
- Agent 问股：模型列表、策略列表、多轮会话、流式输出
- 持仓管理：账户、交易、现金流水、公司行为、快照、风险报告
- 系统设置：配置项读取/保存/校验，认证开关
- 邮件通知：SMTP 邮件推送（分析完成后发送）
- 认证系统：登录、登出、改密、运行时认证开关
- 使用统计：按周期汇总 token/cost 与模型维度统计

## 技术栈

- 前端：Next.js App Router, React, Tailwind, ShadCN 风格组件, Zustand, TanStack Query/Table/Virtual, TradingView Lightweight Charts v5
- 后端：Express 4, better-sqlite3, JWT, multer
- 数据：SQLite

## 快速开始

```bash
npm install
npm run dev
```

默认地址：
- 原版 UI（默认入口）：`http://127.0.0.1:8888`
- 可选 Next UI（迁移版）：`http://127.0.0.1:3000`（需运行 `npm run dev:v2` 或 `npm run start:v2`）
  - 其中 `http://127.0.0.1:3000/v2` 为“功能与布局一致（Parity）”基线页面

默认管理员：
- 用户名：`admin`
- 密码：`admin123456`

## 目录结构

```text
.
├── app/                    # Next.js App Router（新版 UI）
├── components/             # UI 组件（ShadCN 风格）
├── lib/                    # API 访问与工具函数
├── stores/                 # Zustand 状态
├── public/                 # 旧版静态前端资源（保留）
├── src/
│   ├── config/             # 环境配置
│   ├── db/                 # SQLite 初始化
│   ├── repositories/       # 数据访问层
│   ├── services/           # 业务服务层
│   ├── controllers/        # 控制器层
│   ├── routes/             # 路由层
│   ├── middlewares/        # 中间件
│   ├── events/             # SSE 事件流
│   └── server.js           # 应用入口
└── docs/                   # 需求/设计/API 文档
```

## 说明

- 不使用 CDN：新版前端依赖均通过本地 npm 包打包；旧版页面中的 Google Fonts 外链已移除。
- 新版股票详情页：`/stock/[code]` 使用服务端 `generateMetadata()` 动态生成 SEO 元信息。
- 新版股票监测页：使用 TanStack Virtual，支持大数据量滚动不卡顿（含 1000 行压测模式）。
- 当前保留旧版页面作为功能兜底入口，确保“重构不改功能”。
- 行情优先使用 Yahoo Finance，若外部行情不可用会自动降级到本地确定性合成行情（`synthetic`），保证分析链路可用。
- 当前已实现邮件通知（配置项：`EMAIL_ENABLED/EMAIL_SMTP_HOST/EMAIL_SMTP_PORT/EMAIL_SMTP_SECURE/EMAIL_SENDER/EMAIL_PASSWORD/EMAIL_RECEIVERS`）。
- 文档详见 `docs/` 目录：需求、功能清单、设计说明、API 说明与参考项目功能映射。

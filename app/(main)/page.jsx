import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AnalysisTriggerForm } from '@/components/analysis/analysis-trigger-form';
import { TaskStreamPanel } from '@/components/analysis/task-stream-panel';
import { PriceVolumeChart } from '@/components/charts/price-volume-chart';
import { getAnalysisTasks, getMarketReview, getStockMonitor } from '@/lib/server-api';
import { compact, signed, toCandles } from '@/lib/format';
import { triggerAnalysisAction } from '@/app/actions/analysis-actions';

function sentimentBadge(overview) {
  const sentiment = overview?.sentiment || 'neutral';
  if (sentiment === 'risk-on') return <Badge variant="success">Risk On</Badge>;
  if (sentiment === 'risk-off') return <Badge variant="danger">Risk Off</Badge>;
  return <Badge variant="outline">Neutral</Badge>;
}

export default async function DashboardPage() {
  const [market, tasks, monitor] = await Promise.all([
    getMarketReview('both').catch(() => null),
    getAnalysisTasks(20).catch(() => []),
    getStockMonitor('1m', 120).catch(() => null),
  ]);

  const focusItem = monitor?.items?.find((item) => !item.error) || monitor?.items?.[0] || null;
  const chartData = toCandles(focusItem?.candles || []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold md:text-2xl">实时仪表盘</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Server Components 首屏预取 + SSE 任务流 + Canvas 图表，目标是首屏秒开与交互零卡顿。
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>A股情绪</CardDescription>
            <CardTitle className="text-xl">{market?.cn?.overview?.score ?? '--'}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            {sentimentBadge(market?.cn?.overview)}
            <span className="text-xs text-muted-foreground">{market?.cn?.overview?.text || '暂无数据'}</span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>美股情绪</CardDescription>
            <CardTitle className="text-xl">{market?.us?.overview?.score ?? '--'}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            {sentimentBadge(market?.us?.overview)}
            <span className="text-xs text-muted-foreground">{market?.us?.overview?.text || '暂无数据'}</span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>监控标的</CardDescription>
            <CardTitle className="text-xl">{monitor?.total ?? 0}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            成功 {monitor?.success ?? 0} / 失败 {monitor?.failed ?? 0}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>焦点标的</CardDescription>
            <CardTitle className="text-xl">{focusItem?.stockCode || '--'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            <p>最新价：{focusItem?.quote?.price ? Number(focusItem.quote.price).toFixed(2) : '--'}</p>
            <p>涨跌幅：{signed(focusItem?.quote?.changePct, 2, '%')}</p>
            <p>成交量：{compact(focusItem?.quote?.volume)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader>
            <CardTitle>核心图表（TradingView Lightweight Charts）</CardTitle>
            <CardDescription>移动端支持手势缩放，增量更新能力已预留。</CardDescription>
          </CardHeader>
          <CardContent>
            {chartData.length ? (
              <PriceVolumeChart data={chartData} height={420} className="w-full" />
            ) : (
              <p className="text-sm text-muted-foreground">暂无图表数据</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>单股分析入口</CardTitle>
            <CardDescription>Server Action 触发分析，任务流实时反馈。</CardDescription>
          </CardHeader>
          <CardContent>
            <AnalysisTriggerForm action={triggerAnalysisAction} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader>
            <CardTitle>实时任务</CardTitle>
            <CardDescription>SSE 增量更新，无需轮询全量重绘。</CardDescription>
          </CardHeader>
          <CardContent>
            <TaskStreamPanel initialTasks={tasks} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>快捷入口</CardTitle>
            <CardDescription>独立路由页支持 SEO 与 SSR。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Link href="/stock/600519" className="block rounded-lg border border-border/60 px-3 py-2 hover:bg-muted">
              查看 `600519` 股票详情页（SSR + Metadata）
            </Link>
            <Link href="/stock/AAPL" className="block rounded-lg border border-border/60 px-3 py-2 hover:bg-muted">
              查看 `AAPL` 股票详情页（SSR + Metadata）
            </Link>
            <Link href="/stock-monitor" className="block rounded-lg border border-border/60 px-3 py-2 hover:bg-muted">
              打开行情监测（混合品种）
            </Link>
            <Link href="/v2" className="block rounded-lg border border-border/60 px-3 py-2 hover:bg-muted">
              打开“功能与布局一致”重构基线页（Parity）
            </Link>
            <a
              href={`${process.env.BACKEND_ORIGIN || 'http://127.0.0.1:8889'}/`}
              className="block rounded-lg border border-border/60 px-3 py-2 hover:bg-muted"
              target="_blank"
              rel="noreferrer"
            >
              进入旧版全功能后台（功能兜底）
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getStockMonitor } from '@/lib/server-api';
import { StockMonitorTable } from '@/components/stock-monitor/stock-monitor-table';

export default async function WatchlistPage() {
  const initialData = await getStockMonitor('30s', 120).catch(() => ({
    timeframe: '30s',
    items: [],
    total: 0,
    success: 0,
    failed: 0,
  }));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold md:text-2xl">自选股</h1>
      <Card>
        <CardHeader>
          <CardTitle>高性能行情表</CardTitle>
          <CardDescription>
            TanStack Table + TanStack Virtual。默认真实数据渲染，可开启 1000 行前端压力模式做 FPS 验证。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StockMonitorTable initialData={initialData} />
        </CardContent>
      </Card>
    </div>
  );
}

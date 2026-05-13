import { MarketMetricsPanel } from '@/components/modules/market-metrics-panel';

export default function MarketMetricsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold md:text-2xl">A股市场统计指标</h1>
      <MarketMetricsPanel />
    </div>
  );
}

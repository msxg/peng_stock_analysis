import { MarketDataPanel } from '@/components/modules/market-data-panel';

export default function MarketDataPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold md:text-2xl">行情数据</h1>
      <MarketDataPanel />
    </div>
  );
}


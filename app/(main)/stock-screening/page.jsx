import { StockScreeningPanel } from '@/components/modules/stock-screening-panel';

export default function StockScreeningPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold md:text-2xl">条件选股</h1>
      <StockScreeningPanel />
    </div>
  );
}

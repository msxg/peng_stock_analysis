import { PortfolioPanel } from '@/components/modules/portfolio-panel';

export default function PortfolioPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold md:text-2xl">持仓管理</h1>
      <PortfolioPanel />
    </div>
  );
}

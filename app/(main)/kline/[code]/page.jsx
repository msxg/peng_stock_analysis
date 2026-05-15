import { KlineMarketPanel } from '@/components/modules/kline-market-panel';

export default async function KlineCodePage({ params }) {
  const resolved = await params;
  const code = String(resolved?.code || '').trim();

  return (
    <div className="space-y-4">
      <KlineMarketPanel initialCode={code} />
    </div>
  );
}

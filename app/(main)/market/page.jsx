import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { signed } from '@/lib/format';
import { getMarketReview } from '@/lib/server-api';

function RegionPanel({ title, region }) {
  const indices = Array.isArray(region?.indices) ? region.indices : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{region?.overview?.sentiment || 'neutral'}</Badge>
          <span className="text-sm text-muted-foreground">{region?.overview?.text || '暂无结论'}</span>
        </div>
        <div className="space-y-2">
          {indices.map((item) => (
            <div key={item.code} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-sm">
              <div>
                <p className="font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground">{item.code}</p>
              </div>
              <div className="text-right">
                <p>{item.price ? Number(item.price).toFixed(2) : '--'}</p>
                <p className={Number(item.changePct || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                  {signed(item.changePct, 2, '%')}
                </p>
              </div>
            </div>
          ))}
          {!indices.length ? <p className="text-sm text-muted-foreground">暂无数据</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default async function MarketPage() {
  const data = await getMarketReview('both').catch(() => null);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold md:text-2xl">市场复盘</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <RegionPanel title="A股市场" region={data?.cn} />
        <RegionPanel title="美股市场" region={data?.us} />
      </div>
    </div>
  );
}

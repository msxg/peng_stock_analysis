import Link from 'next/link';
import { Suspense } from 'react';
import { PriceVolumeChart } from '@/components/charts/price-volume-chart';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { compact, signed, toCandles } from '@/lib/format';
import { getStockBasicsDetail, getStockHistory, getStockQuote } from '@/lib/server-api';

function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase();
}

async function resolveCode(paramsInput) {
  const params = await paramsInput;
  return normalizeCode(params?.code);
}

export async function generateMetadata({ params }) {
  const code = await resolveCode(params);
  if (!code) {
    return {
      title: '股票详情',
      description: '股票实时行情与图表分析',
      keywords: ['股票', '行情'],
    };
  }

  try {
    const detail = await getStockBasicsDetail(code);
    const name = detail?.local?.name || detail?.remoteQuote?.stockName || code;
    const description = `${code} ${name} 实时行情、K线趋势、量价变化与分析结论。`;
    return {
      title: `${code} ${name} | 股票详情`,
      description,
      keywords: [code, name, '股票', '行情', 'K线', '量化分析'],
    };
  } catch {
    return {
      title: `${code} | 股票详情`,
      description: `${code} 实时行情与图表分析`,
      keywords: [code, '股票', '行情'],
    };
  }
}

function StockHeaderSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <Skeleton className="h-6 w-52" />
        <div className="grid gap-3 md:grid-cols-4">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      </CardContent>
    </Card>
  );
}

function StockChartSkeleton() {
  return (
    <Card>
      <CardContent className="pt-5">
        <Skeleton className="h-[460px] w-full" />
      </CardContent>
    </Card>
  );
}

async function StockHeader({ code }) {
  const [detail, quote] = await Promise.all([
    getStockBasicsDetail(code).catch(() => null),
    getStockQuote(code).catch(() => null),
  ]);

  const name = detail?.local?.name || quote?.stockName || code;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl md:text-2xl">{code} · {name}</CardTitle>
        <CardDescription>
          服务端渲染 + 动态 Metadata。页面源码中可直接读取代码与名称，便于搜索引擎抓取。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-border/60 p-3">
          <p className="text-xs text-muted-foreground">最新价</p>
          <p className="mt-1 text-lg font-semibold">{quote?.price ? Number(quote.price).toFixed(2) : '--'}</p>
        </div>
        <div className="rounded-lg border border-border/60 p-3">
          <p className="text-xs text-muted-foreground">涨跌幅</p>
          <p className={Number(quote?.changePct || 0) >= 0 ? 'mt-1 text-lg font-semibold text-emerald-600' : 'mt-1 text-lg font-semibold text-red-600'}>
            {signed(quote?.changePct, 2, '%')}
          </p>
        </div>
        <div className="rounded-lg border border-border/60 p-3">
          <p className="text-xs text-muted-foreground">成交量</p>
          <p className="mt-1 text-lg font-semibold">{compact(quote?.volume)}</p>
        </div>
        <div className="rounded-lg border border-border/60 p-3">
          <p className="text-xs text-muted-foreground">数据源</p>
          <p className="mt-1 text-lg font-semibold">{quote?.dataSource || '--'}</p>
        </div>
      </CardContent>
    </Card>
  );
}

async function StockChartBlock({ code }) {
  const history = await getStockHistory(code, 240).catch(() => null);
  const candles = toCandles(history?.items || []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>K线与成交量（Canvas）</CardTitle>
        <CardDescription>支持触控缩放（pinch-to-zoom），并为增量 update 推送预留接口。</CardDescription>
      </CardHeader>
      <CardContent>
        {candles.length ? (
          <PriceVolumeChart data={candles} height={460} className="w-full" />
        ) : (
          <p className="text-sm text-muted-foreground">暂无历史数据</p>
        )}
      </CardContent>
    </Card>
  );
}

export default async function StockDetailPage({ params }) {
  const code = await resolveCode(params);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold md:text-2xl">股票详情</h1>
        <Link href="/stock-monitor" className="text-sm text-primary hover:underline">
          返回监测列表
        </Link>
      </div>

      <Suspense fallback={<StockHeaderSkeleton />}>
        <StockHeader code={code} />
      </Suspense>

      <Suspense fallback={<StockChartSkeleton />}>
        <StockChartBlock code={code} />
      </Suspense>
    </div>
  );
}

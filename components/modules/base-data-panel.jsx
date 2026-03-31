'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { clientApi } from '@/lib/client-api';

function marketLabel(market) {
  if (market === 'A') return 'A股';
  if (market === 'HK') return '港股';
  if (market === 'US') return '美股';
  return market || '-';
}

function formatDateTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatLargeNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  if (Math.abs(num) >= 100000000) {
    return `${num.toFixed(0)} (${(num / 100000000).toFixed(2)}亿)`;
  }
  return num.toFixed(0);
}

function formatFundamentalValue(item, value) {
  if (value === null || value === undefined || value === '') return '--';
  if (item === '上市时间') return String(value).replace(/\D+/g, '').slice(0, 8) || '--';
  if (item === '最新') {
    const num = Number(value);
    return Number.isFinite(num) ? num.toFixed(2) : '--';
  }
  if (['总股本', '流通股', '总市值', '流通市值'].includes(item)) {
    return formatLargeNumber(value);
  }
  return String(value);
}

const NO_WRAP_CELL_STYLE = {
  whiteSpace: 'nowrap',
  wordBreak: 'keep-all',
  overflowWrap: 'normal',
};

export function BaseDataPanel() {
  const [market, setMarket] = useState('');
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeRowKey, setActiveRowKey] = useState('');

  async function search({ silent = false, nextMarket = market, nextKeyword = keyword } = {}) {
    if (!silent) setLoading(true);
    if (!silent) setMessage('');
    try {
      const payload = await clientApi.stockBasics.search({
        market: nextMarket,
        q: nextKeyword.trim(),
        page: 1,
        limit: 80,
      });
      const nextItems = Array.isArray(payload?.items) ? payload.items : [];
      setItems(nextItems);
      setTotal(Number(payload?.total || 0));
      if (!silent) setMessage(`检索完成：${nextItems.length} / ${Number(payload?.total || 0)} 条（当前页）`);
    } catch (error) {
      setMessage(`检索失败：${error.message || '未知错误'}`);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function sync() {
    setLoading(true);
    setMessage('');
    try {
      const payload = await clientApi.stockBasics.sync();
      const failures = (payload?.failedMarkets || [])
        .map((item) => `${item.market}: ${item.message}`)
        .join(' | ');
      const quality = payload?.aFundamentals?.quality || null;
      const qualityText = quality
        ? `；A股字段覆盖：行业 ${quality.withIndustryPct}% / 上市时间 ${quality.withListingDatePct}% / 主营 ${quality.withMainBusinessPct}% / 营业范围 ${quality.withBusinessScopePct}%`
        : '';
      await search({ silent: true });
      setMessage(
        `同步完成：总计 ${payload?.total || 0} 条，A股 ${payload?.markets?.find((x) => x.market === 'A')?.total || 0}，` +
          `港股 ${payload?.markets?.find((x) => x.market === 'HK')?.total || 0}，美股 ${payload?.markets?.find((x) => x.market === 'US')?.total || 0}` +
          qualityText +
          (failures ? `；部分市场失败：${failures}` : ''),
      );
    } catch (error) {
      setMessage(`同步失败：${error.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(code, targetMarket) {
    const rowKey = `${targetMarket || ''}-${code || ''}`;
    setActiveRowKey(rowKey);
    setDetailLoading(true);
    try {
      const payload = await clientApi.stockBasics.detail(code, targetMarket || '', { localOnly: true });
      setDetail(payload);
    } catch (error) {
      setMessage(`详情加载失败：${error.message || '未知错误'}`);
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    search({ silent: true }).catch(() => {});
  }, []);

  const local = detail?.local || null;
  const quote = detail?.remoteQuote || null;
  const detailUpdatedAt = local?.fundamentalsSyncedAt || local?.syncedAt || null;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>股票数据</CardTitle>
          <CardDescription>支持 A 股、港股、美股基础数据同步与检索（保持老版能力）。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={sync} disabled={loading}>
              手动同步最新基础数据
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={market}
              onChange={(event) => {
                const nextMarket = event.target.value;
                setMarket(nextMarket);
                search({ nextMarket }).catch(() => {});
              }}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">全部市场</option>
              <option value="A">A股</option>
              <option value="HK">港股</option>
              <option value="US">美股</option>
            </select>
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="按代码/名称检索，如 600519 / 腾讯 / AAPL"
              onKeyDown={(event) => {
                if (event.key === 'Enter') search().catch(() => {});
              }}
            />
            <Button variant="secondary" onClick={() => search().catch(() => {})} disabled={loading}>
              检索
            </Button>
          </div>

          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

          <div className="max-h-[560px] overflow-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left" style={NO_WRAP_CELL_STYLE}>市场</th>
                  <th className="px-3 py-2 text-left" style={NO_WRAP_CELL_STYLE}>子市场</th>
                  <th className="px-3 py-2 text-left" style={NO_WRAP_CELL_STYLE}>代码</th>
                  <th className="px-3 py-2 text-left" style={NO_WRAP_CELL_STYLE}>名称</th>
                  <th className="px-3 py-2 text-left" style={NO_WRAP_CELL_STYLE}>所属板块</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={`${item.market}-${item.code}`}
                    className={`cursor-pointer border-t border-border/40 hover:bg-muted/30 ${
                      activeRowKey === `${item.market}-${item.code}` ? 'bg-muted/40' : ''
                    }`}
                    onClick={() => loadDetail(item.code, item.market)}
                  >
                    <td className="px-3 py-2" style={NO_WRAP_CELL_STYLE}>{marketLabel(item.market)}</td>
                    <td className="px-3 py-2" style={NO_WRAP_CELL_STYLE}>{item.subMarket || '-'}</td>
                    <td className="px-3 py-2 font-mono" style={NO_WRAP_CELL_STYLE}>{item.code || '-'}</td>
                    <td className="px-3 py-2" style={NO_WRAP_CELL_STYLE}>{item.name || '-'}</td>
                    <td className="px-3 py-2" style={NO_WRAP_CELL_STYLE}>{item.sector || '-'}</td>
                  </tr>
                ))}
                {!items.length ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                      暂无数据，请先同步或检索
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">当前列表总数（查询结果）：{total}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>基础信息详情</CardTitle>
          <CardDescription>仅使用本地基础数据（点击左侧后快速展示，无第三方请求）。</CardDescription>
        </CardHeader>
        <CardContent>
          {detailLoading ? (
            <div className="mb-3 flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
              正在加载本地基础数据...
            </div>
          ) : null}

          {!detail ? <p className="text-sm text-muted-foreground">请选择左侧股票查看详情</p> : null}

          {detail ? (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                  <p className="text-xs text-muted-foreground">市场</p>
                  <p className="text-sm font-semibold">{marketLabel(local?.market || '-')}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                  <p className="text-xs text-muted-foreground">代码</p>
                  <p className="text-sm font-semibold">{detail.code || local?.code || '--'}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                  <p className="text-xs text-muted-foreground">名称</p>
                  <p className="text-sm font-semibold">{local?.name || '--'}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                  <p className="text-xs text-muted-foreground">子市场</p>
                  <p className="text-sm font-semibold">{local?.subMarket || '--'}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                  <p className="text-xs text-muted-foreground">列表同步时间</p>
                  <p className="text-sm font-semibold">{formatDateTime(local?.syncedAt)}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                  <p className="text-xs text-muted-foreground">基础数据更新时间</p>
                  <p className="text-sm font-semibold">{formatDateTime(detailUpdatedAt)}</p>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                  <p className="text-xs text-muted-foreground">数据源</p>
                  <p className="text-sm font-semibold">{local?.fundamentalsSource || local?.source || quote?.dataSource || '--'}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                  <p className="text-xs text-muted-foreground">所属板块</p>
                  <p className="text-sm font-semibold">{local?.sector || '--'}</p>
                </div>
              </div>

              <div className="rounded-md border border-border/60">
                <div className="border-b border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  个股基础信息（本地化）
                </div>
                <div>
                  <table className="w-full text-sm">
                    <tbody>
                      {(detail?.fundamentalItems || []).map((row) => (
                        <tr key={row.item} className="border-b border-border/40 last:border-b-0">
                          <td className="w-40 min-w-28 px-3 py-2 text-muted-foreground" style={NO_WRAP_CELL_STYLE}>{row.item}</td>
                          <td className="px-3 py-2">{formatFundamentalValue(row.item, row.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {detail?.fundamentals?.companyProfile ? (
                <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                  <p className="text-xs text-muted-foreground">公司简介</p>
                  <p className="mt-1 text-sm leading-6">{detail.fundamentals.companyProfile}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

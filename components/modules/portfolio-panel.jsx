'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { clientApi } from '@/lib/client-api';

const DEFAULT_TRADE_JSON = JSON.stringify(
  {
    accountId: 1,
    stockCode: 'AAPL',
    side: 'buy',
    quantity: 10,
    price: 100,
    tradeDate: '2026-03-17',
  },
  null,
  2,
);

function formatValue(value) {
  if (value === null || value === undefined) return '--';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

function toSummaryRows(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const source = payload.summary && typeof payload.summary === 'object' ? payload.summary : payload;
  return Object.entries(source)
    .filter(([, value]) => ['number', 'string', 'boolean'].includes(typeof value))
    .slice(0, 12)
    .map(([key, value]) => ({ key, value: formatValue(value) }));
}

export function PortfolioPanel() {
  const [accountName, setAccountName] = useState('');
  const [tradeJson, setTradeJson] = useState(DEFAULT_TRADE_JSON);
  const [accounts, setAccounts] = useState([]);
  const [activeAccountId, setActiveAccountId] = useState(null);
  const [message, setMessage] = useState('');
  const [viewTitle, setViewTitle] = useState('账户视图');
  const [viewPayload, setViewPayload] = useState(null);
  const [loading, setLoading] = useState(false);

  const summaryRows = useMemo(() => toSummaryRows(viewPayload), [viewPayload]);

  async function loadAccounts() {
    const payload = await clientApi.portfolio.accounts();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    setAccounts(items);
    if (!activeAccountId && items[0]?.id) setActiveAccountId(items[0].id);
  }

  async function onCreateAccount() {
    const name = accountName.trim();
    if (!name) {
      setMessage('请输入账户名称');
      return;
    }

    setLoading(true);
    setMessage('');
    try {
      await clientApi.portfolio.createAccount({ name, baseCurrency: 'CNY' });
      setAccountName('');
      setMessage('账户创建成功');
      await loadAccounts();
    } catch (error) {
      setMessage(`账户创建失败：${error.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  }

  async function onCreateTrade() {
    setLoading(true);
    setMessage('');
    try {
      const payload = JSON.parse(tradeJson || '{}');
      await clientApi.portfolio.createTrade(payload);
      setMessage('交易创建成功');
      await onLoadSnapshot();
    } catch (error) {
      setMessage(`交易失败：${error.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  }

  async function onLoadSnapshot() {
    setLoading(true);
    setMessage('');
    try {
      const payload = await clientApi.portfolio.snapshot(activeAccountId || undefined);
      setViewTitle('账户快照');
      setViewPayload(payload);
    } catch (error) {
      setMessage(`加载快照失败：${error.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  }

  async function onLoadRisk() {
    setLoading(true);
    setMessage('');
    try {
      const payload = await clientApi.portfolio.riskReport(activeAccountId || undefined);
      setViewTitle('风险报告');
      setViewPayload(payload);
    } catch (error) {
      setMessage(`加载风险失败：${error.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAccounts().catch((error) => setMessage(`账户加载失败：${error.message || '未知错误'}`));
  }, []);

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>账户与交易</CardTitle>
          <CardDescription>与老版一致：创建账户 + 提交交易 JSON。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">新账户名称</label>
            <Input value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="主账户" />
          </div>
          <Button onClick={onCreateAccount} disabled={loading}>
            创建账户
          </Button>

          <div>
            <label className="mb-1 block text-sm text-muted-foreground">交易 JSON</label>
            <textarea
              value={tradeJson}
              onChange={(event) => setTradeJson(event.target.value)}
              className="min-h-[180px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono"
            />
          </div>
          <Button variant="secondary" onClick={onCreateTrade} disabled={loading}>
            提交交易
          </Button>
          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>账户列表</CardTitle>
          <CardDescription>与老版一致：刷新账户、快照、风险。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => loadAccounts().catch((error) => setMessage(error.message))} disabled={loading}>
              刷新账户
            </Button>
            <Button variant="outline" onClick={onLoadSnapshot} disabled={loading}>
              快照
            </Button>
            <Button variant="outline" onClick={onLoadRisk} disabled={loading}>
              风险
            </Button>
          </div>

          <div className="max-h-[420px] space-y-2 overflow-auto rounded-lg border border-border/60 p-2">
            {accounts.map((item) => {
              const active = Number(item.id) === Number(activeAccountId);
              return (
                <button
                  type="button"
                  key={item.id}
                  className={`w-full rounded-md border px-3 py-2 text-left ${
                    active ? 'border-primary/40 bg-primary/10' : 'border-border/60 hover:bg-muted/40'
                  }`}
                  onClick={() => {
                    setActiveAccountId(item.id);
                    setMessage(`当前账户: ${item.id}`);
                  }}
                >
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.baseCurrency} | {item.updatedAt || '-'}
                  </p>
                </button>
              );
            })}
            {!accounts.length ? <p className="p-2 text-sm text-muted-foreground">暂无账户</p> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{viewTitle}</CardTitle>
          <CardDescription>保持老版的摘要视图风格。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2">
            {summaryRows.map((item) => (
              <div key={item.key} className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                <p className="text-xs text-muted-foreground">{item.key}</p>
                <p className="text-sm font-semibold">{item.value}</p>
              </div>
            ))}
            {!summaryRows.length ? <p className="text-sm text-muted-foreground">暂无数据</p> : null}
          </div>

          {Array.isArray(viewPayload?.positions) && viewPayload.positions.length ? (
            <div className="mt-3 max-h-[220px] overflow-auto rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">代码</th>
                    <th className="px-3 py-2 text-left">持仓</th>
                    <th className="px-3 py-2 text-left">盈亏%</th>
                  </tr>
                </thead>
                <tbody>
                  {viewPayload.positions.map((item) => (
                    <tr key={item.stockCode} className="border-t border-border/40">
                      <td className="px-3 py-2">{item.stockCode}</td>
                      <td className="px-3 py-2">{formatValue(item.quantity)}</td>
                      <td className={`px-3 py-2 ${Number(item.pnlPct) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {formatValue(item.pnlPct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

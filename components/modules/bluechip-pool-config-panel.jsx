'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { clientApi } from '@/lib/client-api';

export function BluechipPoolConfigPanel() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeTab, setActiveTab] = useState('pools');
  const [allPools, setAllPools] = useState([]);
  const [managePoolId, setManagePoolId] = useState('');
  const [symbolPoolId, setSymbolPoolId] = useState('');
  const [poolForm, setPoolForm] = useState({ name: '', description: '' });
  const [symbolForm, setSymbolForm] = useState({ stockCode: '', stockName: '' });
  const [symbolKeyword, setSymbolKeyword] = useState('');
  const [symbolSuggestions, setSymbolSuggestions] = useState([]);
  const [symbolSuggesting, setSymbolSuggesting] = useState(false);
  const [symbolSuggestError, setSymbolSuggestError] = useState('');
  const [symbolListKeyword, setSymbolListKeyword] = useState('');
  const [symbolPage, setSymbolPage] = useState(1);
  const [symbolPageSize, setSymbolPageSize] = useState(20);
  const [editingSymbolId, setEditingSymbolId] = useState('');
  const [editingSymbolForm, setEditingSymbolForm] = useState({ stockCode: '', stockName: '' });

  const selectedManagePool = useMemo(
    () => allPools.find((item) => String(item.id) === String(managePoolId)) || null,
    [allPools, managePoolId],
  );
  const selectedSymbolPool = useMemo(
    () => allPools.find((item) => String(item.id) === String(symbolPoolId)) || null,
    [allPools, symbolPoolId],
  );

  async function refreshPoolData() {
    setLoading(true);
    try {
      const payload = await clientApi.strategy.bluechipPools();
      const pools = Array.isArray(payload?.items) ? payload.items : [];
      setAllPools(pools);
      if (!managePoolId && pools[0]?.id) {
        setManagePoolId(String(pools[0].id));
      } else if (managePoolId && !pools.find((item) => String(item.id) === String(managePoolId))) {
        setManagePoolId(String(pools[0]?.id || ''));
      }
      if (!symbolPoolId && pools[0]?.id) {
        setSymbolPoolId(String(pools[0].id));
      } else if (symbolPoolId && !pools.find((item) => String(item.id) === String(symbolPoolId))) {
        setSymbolPoolId(String(pools[0]?.id || ''));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshPoolData().catch((loadError) => {
      setError(loadError?.message || '加载标的池失败');
    });
  }, []);

  useEffect(() => {
    if (!selectedManagePool) {
      setPoolForm({ name: '', description: '' });
      return;
    }
    setPoolForm({
      name: selectedManagePool.name || '',
      description: selectedManagePool.description || '',
    });
  }, [selectedManagePool?.id]);

  useEffect(() => {
    setEditingSymbolId('');
    setEditingSymbolForm({ stockCode: '', stockName: '' });
    setSymbolForm({ stockCode: '', stockName: '' });
    setSymbolKeyword('');
    setSymbolSuggestions([]);
    setSymbolSuggestError('');
    setSymbolListKeyword('');
    setSymbolPage(1);
  }, [symbolPoolId]);

  useEffect(() => {
    setSymbolPage(1);
  }, [symbolListKeyword, symbolPageSize]);

  useEffect(() => {
    if (activeTab !== 'symbols') return undefined;
    const q = String(symbolKeyword || '').trim();
    if (!q || !selectedSymbolPool) {
      setSymbolSuggestions([]);
      setSymbolSuggestError('');
      setSymbolSuggesting(false);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSymbolSuggesting(true);
      setSymbolSuggestError('');
      try {
        const payload = await clientApi.stockBasics.suggest({ q, limit: 20 });
        if (cancelled) return;
        const rows = Array.isArray(payload?.items) ? payload.items : [];
        setSymbolSuggestions(rows);
      } catch (suggestError) {
        if (cancelled) return;
        setSymbolSuggestions([]);
        setSymbolSuggestError(suggestError?.message || '检索失败');
      } finally {
        if (!cancelled) setSymbolSuggesting(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeTab, selectedSymbolPool, symbolKeyword]);

  const filteredSymbols = useMemo(() => {
    const rows = Array.isArray(selectedSymbolPool?.symbols) ? selectedSymbolPool.symbols : [];
    const q = String(symbolListKeyword || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((item) => {
      const code = String(item?.stockCode || '').toLowerCase();
      const name = String(item?.stockName || '').toLowerCase();
      return code.includes(q) || name.includes(q);
    });
  }, [selectedSymbolPool?.symbols, symbolListKeyword]);

  const symbolTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredSymbols.length / Math.max(1, Number(symbolPageSize) || 1))),
    [filteredSymbols.length, symbolPageSize],
  );

  useEffect(() => {
    setSymbolPage((prev) => {
      if (prev > symbolTotalPages) return symbolTotalPages;
      if (prev < 1) return 1;
      return prev;
    });
  }, [symbolTotalPages]);

  const pagedSymbols = useMemo(() => {
    const page = Math.max(1, Math.min(symbolPage, symbolTotalPages));
    const size = Math.max(1, Number(symbolPageSize) || 1);
    const start = (page - 1) * size;
    return filteredSymbols.slice(start, start + size);
  }, [filteredSymbols, symbolPage, symbolPageSize, symbolTotalPages]);

  async function handleCreatePool() {
    const name = String(poolForm.name || '').trim();
    if (!name) {
      setError('请填写标的池名称');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await clientApi.strategy.createBluechipPool({
        name,
        description: String(poolForm.description || '').trim(),
        isEnabled: true,
      });
      await refreshPoolData();
      setNotice('标的池已创建');
    } catch (createError) {
      setError(createError?.message || '创建标的池失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdatePool() {
    if (!selectedManagePool) {
      setError('请先选择一个标的池');
      return;
    }
    const name = String(poolForm.name || selectedManagePool.name || '').trim();
    if (!name) {
      setError('请填写标的池名称');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await clientApi.strategy.updateBluechipPool(selectedManagePool.id, {
        name,
        description: String(poolForm.description || '').trim(),
      });
      await refreshPoolData();
      setNotice('标的池已更新');
    } catch (updateError) {
      setError(updateError?.message || '更新标的池失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePool() {
    if (!selectedManagePool) {
      setError('请先选择一个标的池');
      return;
    }
    if (!window.confirm(`确认删除标的池「${selectedManagePool.name}」吗？`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await clientApi.strategy.deleteBluechipPool(selectedManagePool.id);
      await refreshPoolData();
      setNotice('标的池已删除');
    } catch (deleteError) {
      setError(deleteError?.message || '删除标的池失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateSymbol() {
    if (!selectedSymbolPool) {
      setError('请先选择一个标的池');
      return;
    }
    const stockCode = String(symbolForm.stockCode || '').trim().toUpperCase();
    if (!stockCode) {
      setError('请输入股票代码');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await clientApi.strategy.createBluechipPoolSymbol(selectedSymbolPool.id, {
        stockCode,
        stockName: String(symbolForm.stockName || '').trim(),
      });
      await refreshPoolData();
      setSymbolForm({ stockCode: '', stockName: '' });
      setNotice('标的代码已添加');
    } catch (createError) {
      setError(createError?.message || '添加标的代码失败');
    } finally {
      setSaving(false);
    }
  }

  function selectSuggestedSymbol(item = {}) {
    const code = String(item?.code || item?.stockCode || '').trim().toUpperCase();
    const name = String(item?.name || '').trim();
    if (!code) return;
    setSymbolForm((prev) => ({
      ...prev,
      stockCode: code,
      stockName: name || prev.stockName,
    }));
    setSymbolKeyword(name || code);
    setSymbolSuggestions([]);
    setSymbolSuggestError('');
  }

  async function handleUpdateSymbol() {
    if (!selectedSymbolPool || !editingSymbolId) {
      setError('请先选择要更新的代码');
      return;
    }
    const stockCode = String(editingSymbolForm.stockCode || '').trim().toUpperCase();
    if (!stockCode) {
      setError('股票代码不能为空');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await clientApi.strategy.updateBluechipPoolSymbol(selectedSymbolPool.id, editingSymbolId, {
        stockCode,
        stockName: String(editingSymbolForm.stockName || '').trim(),
      });
      await refreshPoolData();
      setEditingSymbolId('');
      setEditingSymbolForm({ stockCode: '', stockName: '' });
      setNotice('标的代码已更新');
    } catch (updateError) {
      setError(updateError?.message || '更新标的代码失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSymbol(symbolId) {
    if (!selectedSymbolPool || !symbolId) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await clientApi.strategy.deleteBluechipPoolSymbol(selectedSymbolPool.id, symbolId);
      if (String(editingSymbolId) === String(symbolId)) {
        setEditingSymbolId('');
        setEditingSymbolForm({ stockCode: '', stockName: '' });
      }
      await refreshPoolData();
      setNotice('标的代码已删除');
    } catch (deleteError) {
      setError(deleteError?.message || '删除标的代码失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleClearPoolSymbols() {
    if (!selectedSymbolPool) {
      setError('请先选择一个标的池');
      return;
    }
    const total = Array.isArray(selectedSymbolPool.symbols)
      ? selectedSymbolPool.symbols.filter((item) => item?.isActive !== false).length
      : 0;
    if (total <= 0) {
      setNotice('当前标的池已是空');
      return;
    }
    if (!window.confirm(`确认清空标的池「${selectedSymbolPool.name}」下全部 ${total} 条标的吗？`)) return;

    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await clientApi.strategy.clearBluechipPoolSymbols(selectedSymbolPool.id);
      if (String(editingSymbolId || '').trim()) {
        setEditingSymbolId('');
        setEditingSymbolForm({ stockCode: '', stockName: '' });
      }
      await refreshPoolData();
      const cleared = Number(result?.cleared || 0);
      setNotice(`标的池已清空：${cleared} 条`);
    } catch (clearError) {
      setError(clearError?.message || '清空标的池失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold md:text-2xl">标的池配置</h1>
        <p className="mt-1 text-sm text-muted-foreground">集中管理标的池与池内标的代码，配置会同步到蓝筹批量分析页面的“标的来源”。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>配置中心</CardTitle>
          <CardDescription>分为“标的池管理”和“标的管理”两个模块。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="inline-flex rounded-lg border border-border p-1">
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 text-sm ${activeTab === 'pools' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
              onClick={() => setActiveTab('pools')}
            >
              标的池管理
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 text-sm ${activeTab === 'symbols' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
              onClick={() => setActiveTab('symbols')}
            >
              标的管理
            </button>
          </div>

          {activeTab === 'pools' ? (
            <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
              <div className="rounded-lg border border-border/70">
                <div className="border-b border-border/60 px-3 py-2 text-sm font-semibold">标的池列表</div>
                <div className="max-h-[60vh] overflow-auto p-2">
                  {allPools.length === 0 ? (
                    <p className="px-2 py-3 text-sm text-muted-foreground">{loading ? '加载中...' : '暂无标的池'}</p>
                  ) : null}
                  {allPools.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`mb-1 w-full rounded-md border px-3 py-2 text-left text-sm ${
                        String(managePoolId) === String(item.id) ? 'border-primary bg-primary/10' : 'border-border/60 hover:bg-muted/50'
                      }`}
                      onClick={() => {
                        setManagePoolId(String(item.id));
                        setError('');
                        setNotice('');
                      }}
                    >
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.code} · {Array.isArray(item.symbols) ? item.symbols.filter((sym) => sym?.isActive !== false).length : 0} 只
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border/70 p-3">
                <div className="mb-2 text-sm font-semibold">标的池信息</div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">编码</label>
                    <Input
                      value={selectedManagePool?.code || ''}
                      placeholder="创建后自动生成"
                      readOnly
                      disabled
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">名称</label>
                    <Input
                      value={poolForm.name}
                      onChange={(event) => setPoolForm((prev) => ({ ...prev, name: event.target.value }))}
                      placeholder="例如 科创50成分股"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">说明</label>
                    <Input
                      value={poolForm.description}
                      onChange={(event) => setPoolForm((prev) => ({ ...prev, description: event.target.value }))}
                      placeholder="可选"
                    />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" onClick={handleCreatePool} disabled={saving}>
                    <Plus className="size-4" />
                    新建标的池
                  </Button>
                  <Button type="button" variant="outline" onClick={handleUpdatePool} disabled={saving || !selectedManagePool}>
                    保存当前标的池
                  </Button>
                  <Button type="button" variant="outline" onClick={handleDeletePool} disabled={saving || !selectedManagePool}>
                    <Trash2 className="size-4" />
                    删除当前标的池
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-border/70 p-3">
                <div className="grid gap-3">
                  <div>
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <label className="text-xs text-muted-foreground">标的池（必选）</label>
                      <span className="text-xs text-muted-foreground">
                        {selectedSymbolPool
                          ? `当前管理：${selectedSymbolPool.name}（${selectedSymbolPool.code}），共 ${Array.isArray(selectedSymbolPool.symbols) ? selectedSymbolPool.symbols.filter((sym) => sym?.isActive !== false).length : 0} 只`
                          : '请先选择一个标的池'}
                      </span>
                    </div>
                    <Select value={symbolPoolId} onValueChange={setSymbolPoolId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="请选择标的池" />
                      </SelectTrigger>
                      <SelectContent>
                        {allPools.map((item) => (
                          <SelectItem key={item.id} value={String(item.id)}>
                            {item.name}（{item.code}）
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border/70 p-3">
                <div className="mb-2 text-sm font-semibold">标的代码管理</div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">股票代码</label>
                    <Input
                      value={symbolForm.stockCode}
                      onChange={(event) => setSymbolForm((prev) => ({ ...prev, stockCode: event.target.value.toUpperCase() }))}
                      placeholder="例如 000333 / SH600519"
                      disabled={!selectedSymbolPool}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">股票检索（名称/缩写/代码）</label>
                    <Input
                      value={symbolKeyword}
                      onChange={(event) => setSymbolKeyword(event.target.value)}
                      placeholder="例如 美的集团 / midea / 000333"
                      disabled={!selectedSymbolPool}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-transparent select-none" aria-hidden="true">操作</label>
                    <div className="grid gap-2">
                      <Button type="button" className="w-full" onClick={handleCreateSymbol} disabled={saving || !selectedSymbolPool}>
                        <Plus className="size-4" />
                        添加代码
                      </Button>
                      <Button
                        type="button"
                        className="w-full"
                        variant="outline"
                        onClick={handleClearPoolSymbols}
                        disabled={saving || !selectedSymbolPool}
                      >
                        <Trash2 className="size-4" />
                        清空当前池标的
                      </Button>
                    </div>
                  </div>
                </div>
                {(symbolSuggesting || symbolSuggestError || symbolSuggestions.length > 0) && selectedSymbolPool ? (
                  <div className="mt-2 overflow-hidden rounded-lg border border-border/70 bg-card">
                    {symbolSuggesting ? (
                      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" />
                        检索中...
                      </div>
                    ) : null}
                    {symbolSuggestError ? <p className="px-3 py-2 text-xs text-red-600">检索失败：{symbolSuggestError}</p> : null}
                    {!symbolSuggesting && !symbolSuggestError && symbolSuggestions.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">暂无匹配结果</p>
                    ) : null}
                    {symbolSuggestions.map((item, idx) => (
                      <button
                        key={`${item?.market || '--'}-${item?.code || item?.stockCode || 'code'}-${idx}`}
                        type="button"
                        onClick={() => selectSuggestedSymbol(item)}
                        className="flex w-full items-center justify-between gap-2 border-t border-border/50 px-3 py-2 text-left hover:bg-muted/40 first:border-t-0"
                      >
                        <span className="truncate text-sm font-medium">{item?.name || item?.code || item?.stockCode || '--'}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {item?.code || item?.stockCode || '--'}{item?.market ? ` · ${item.market}` : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="mt-3 overflow-hidden rounded-lg border border-border/60">
                  <div className="border-b border-border/60 px-3 py-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                      <Input
                        value={symbolListKeyword}
                        onChange={(event) => setSymbolListKeyword(event.target.value)}
                        placeholder="按代码/名称筛选已添加标的"
                        className="pl-9"
                      />
                    </div>
                  </div>
                  <div className="overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/70 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left">代码</th>
                          <th className="px-3 py-2 text-left">名称</th>
                          <th className="px-3 py-2 text-left">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!selectedSymbolPool || !Array.isArray(selectedSymbolPool.symbols) || selectedSymbolPool.symbols.length === 0 ? (
                          <tr>
                            <td className="px-3 py-4 text-center text-muted-foreground" colSpan={3}>暂无代码</td>
                          </tr>
                        ) : null}
                        {selectedSymbolPool && filteredSymbols.length === 0 && selectedSymbolPool.symbols?.length > 0 ? (
                          <tr>
                            <td className="px-3 py-4 text-center text-muted-foreground" colSpan={3}>没有匹配的标的</td>
                          </tr>
                        ) : null}
                        {pagedSymbols.map((item) => {
                          const isEditing = String(editingSymbolId) === String(item.id);
                          return (
                            <tr key={item.id} className="border-t border-border/50">
                              <td className="px-3 py-2">
                                {isEditing ? (
                                  <Input
                                    value={editingSymbolForm.stockCode}
                                    onChange={(event) => setEditingSymbolForm((prev) => ({ ...prev, stockCode: event.target.value.toUpperCase() }))}
                                  />
                                ) : item.stockCode}
                              </td>
                              <td className="px-3 py-2">
                                {isEditing ? (
                                  <Input
                                    value={editingSymbolForm.stockName}
                                    onChange={(event) => setEditingSymbolForm((prev) => ({ ...prev, stockName: event.target.value }))}
                                  />
                                ) : (item.stockName || '--')}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex flex-wrap gap-2">
                                  {isEditing ? (
                                    <>
                                      <Button type="button" size="sm" onClick={handleUpdateSymbol} disabled={saving}>保存</Button>
                                      <Button type="button" size="sm" variant="outline" onClick={() => setEditingSymbolId('')} disabled={saving}>取消</Button>
                                    </>
                                  ) : (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
                                        setEditingSymbolId(String(item.id));
                                        setEditingSymbolForm({
                                          stockCode: item.stockCode || '',
                                          stockName: item.stockName || '',
                                        });
                                      }}
                                    >
                                      编辑
                                    </Button>
                                  )}
                                  <Button type="button" size="sm" variant="outline" onClick={() => handleDeleteSymbol(item.id)} disabled={saving}>
                                    删除
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {selectedSymbolPool && filteredSymbols.length > 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
                      <div>
                        第 {symbolPage} / {symbolTotalPages} 页，共 {filteredSymbols.length} 条
                      </div>
                      <div className="flex items-center gap-2">
                        <Select value={String(symbolPageSize)} onValueChange={(value) => setSymbolPageSize(Number(value) || 20)}>
                          <SelectTrigger className="h-8 w-[110px]">
                            <SelectValue placeholder="每页条数" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="10">每页 10</SelectItem>
                            <SelectItem value="20">每页 20</SelectItem>
                            <SelectItem value="50">每页 50</SelectItem>
                            <SelectItem value="100">每页 100</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button type="button" size="sm" variant="outline" disabled={symbolPage <= 1} onClick={() => setSymbolPage((prev) => Math.max(1, prev - 1))}>
                          上一页
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={symbolPage >= symbolTotalPages}
                          onClick={() => setSymbolPage((prev) => Math.min(symbolTotalPages, prev + 1))}
                        >
                          下一页
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {!error && notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

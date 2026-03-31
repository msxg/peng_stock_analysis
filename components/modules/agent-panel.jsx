'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { clientApi } from '@/lib/client-api';

export function AgentPanel() {
  const [message, setMessage] = useState('AAPL 当前趋势如何？给我一个简明建议。');
  const [sessionId, setSessionId] = useState('');
  const [reply, setReply] = useState('暂无回复');
  const [strategies, setStrategies] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  async function loadStrategies() {
    const payload = await clientApi.agent.strategies();
    setStrategies(Array.isArray(payload?.items) ? payload.items : []);
  }

  async function loadSessions() {
    const payload = await clientApi.agent.sessions();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    setSessions(items);
    if (!sessionId && items[0]?.sessionId) setSessionId(items[0].sessionId);
  }

  async function loadSessionMessages(targetSessionId) {
    if (!targetSessionId) return;
    const payload = await clientApi.agent.sessionMessages(targetSessionId);
    setMessages(Array.isArray(payload?.items) ? payload.items : []);
  }

  async function send() {
    setLoading(true);
    try {
      const enabledStrategies = strategies.filter((item) => item.enabled).map((item) => item.key);
      const payload = await clientApi.agent.chat({
        message,
        sessionId: sessionId || undefined,
        strategies: enabledStrategies,
      });
      setReply(payload?.message || '无回复');
      if (payload?.sessionId) {
        setSessionId(payload.sessionId);
        await loadSessions();
        await loadSessionMessages(payload.sessionId);
      }
    } catch (error) {
      setReply(`调用失败：${error.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStrategies().catch(() => {});
    loadSessions().catch(() => {});
  }, []);

  useEffect(() => {
    loadSessionMessages(sessionId).catch(() => {});
  }, [sessionId]);

  const enabledStrategyNames = useMemo(
    () => strategies.filter((item) => item.enabled).map((item) => item.name || item.key),
    [strategies],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Agent 问股（策略库）</CardTitle>
          <CardDescription>支持多轮会话，调用后端 `/api/v1/agent/*` 能力。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            className="min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={send} disabled={loading}>
              {loading ? '发送中...' : '发送'}
            </Button>
            <Button variant="secondary" onClick={() => loadStrategies().catch(() => {})}>
              刷新策略库
            </Button>
            <Button variant="outline" onClick={() => loadSessions().catch(() => {})}>
              刷新会话
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">启用策略：{enabledStrategyNames.join('、') || '无'}</p>
          <div className="rounded-lg border border-border/60 bg-muted/40 p-3 text-sm whitespace-pre-wrap">{reply}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>会话与消息</CardTitle>
          <CardDescription>与老版右侧“历史会话/会话消息”一致。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <select
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">请选择会话</option>
            {sessions.map((item) => (
              <option key={item.sessionId} value={item.sessionId}>
                {item.title || item.sessionId}
              </option>
            ))}
          </select>

          <div className="max-h-[360px] space-y-2 overflow-auto rounded-lg border border-border/60 bg-muted/25 p-2">
            {messages.map((item) => (
              <div key={item.id} className="rounded-md border border-border/60 bg-card px-3 py-2 text-sm">
                <p className="mb-1 text-xs text-muted-foreground">{item.role}</p>
                <p className="whitespace-pre-wrap">{item.content}</p>
              </div>
            ))}
            {!messages.length ? <p className="p-2 text-sm text-muted-foreground">暂无消息</p> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

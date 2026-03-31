'use client';

import { useEffect, useMemo, useState } from 'react';
import { clientApi } from '@/lib/client-api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

function statusVariant(status) {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'running') return 'secondary';
  return 'outline';
}

export function TaskStreamPanel({ initialTasks = [] }) {
  const [tasks, setTasks] = useState(initialTasks);

  useEffect(() => {
    const source = new EventSource('/api/v1/analysis/tasks/stream', { withCredentials: true });

    const refresh = async () => {
      try {
        const payload = await clientApi.analysisTasks(30);
        setTasks(Array.isArray(payload?.items) ? payload.items : []);
      } catch {
        // ignore
      }
    };

    ['task_created', 'task_started', 'task_progress', 'task_completed', 'task_failed'].forEach((eventName) => {
      source.addEventListener(eventName, refresh);
    });

    source.onerror = () => {
      source.close();
    };

    return () => {
      source.close();
    };
  }, []);

  const sorted = useMemo(
    () =>
      [...(Array.isArray(tasks) ? tasks : [])]
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .slice(0, 20),
    [tasks],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">任务队列（SSE 实时）</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const payload = await clientApi.analysisTasks(30);
            setTasks(Array.isArray(payload?.items) ? payload.items : []);
          }}
        >
          刷新
        </Button>
      </div>
      <div className="max-h-72 space-y-2 overflow-auto pr-1">
        {sorted.map((task) => (
          <div key={task.taskId} className="rounded-lg border border-border/60 bg-card p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{(task.stockCodes || []).join(', ') || '-'}</span>
              <Badge variant={statusVariant(task.status)}>{task.status}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">任务ID: {task.taskId}</p>
          </div>
        ))}
        {!sorted.length ? <p className="text-sm text-muted-foreground">暂无任务</p> : null}
      </div>
    </div>
  );
}

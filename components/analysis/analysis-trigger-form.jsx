'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? '执行中...' : '立即分析'}
    </Button>
  );
}

export function AnalysisTriggerForm({ action }) {
  const [state, formAction] = useActionState(action, { ok: false, message: '' });

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          name="stockList"
          placeholder="输入股票代码，逗号分隔，例如 AAPL,600519,00700"
          defaultValue="AAPL,600519"
        />
        <SubmitButton />
      </div>
      <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" name="runAsync" defaultChecked className="size-4" />
        异步任务模式（推荐）
      </label>
      {state.message ? (
        <Badge variant={state.ok ? 'success' : 'danger'} className="w-fit">
          {state.message}
        </Badge>
      ) : null}
    </form>
  );
}

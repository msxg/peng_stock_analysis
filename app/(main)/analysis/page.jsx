import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AnalysisTriggerForm } from '@/components/analysis/analysis-trigger-form';
import { TaskStreamPanel } from '@/components/analysis/task-stream-panel';
import { getAnalysisTasks } from '@/lib/server-api';
import { triggerAnalysisAction } from '@/app/actions/analysis-actions';

export default async function AnalysisPage() {
  const tasks = await getAnalysisTasks(30).catch(() => []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold md:text-2xl">分析中心</h1>

      <Card>
        <CardHeader>
          <CardTitle>发起分析</CardTitle>
          <CardDescription>通过 Server Action 触发，保持首屏体积更小。</CardDescription>
        </CardHeader>
        <CardContent>
          <AnalysisTriggerForm action={triggerAnalysisAction} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>任务队列</CardTitle>
          <CardDescription>SSE 事件流：task_created/task_progress/task_completed。</CardDescription>
        </CardHeader>
        <CardContent>
          <TaskStreamPanel initialTasks={tasks} />
        </CardContent>
      </Card>
    </div>
  );
}

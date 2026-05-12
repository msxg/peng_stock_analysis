import Link from 'next/link';
import { BluechipModePanel } from '@/components/modules/bluechip-mode-panel';
import { Button } from '@/components/ui/button';

export default function BluechipModePage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold md:text-2xl">蓝筹模式</h1>
        <Link href="/bluechip-batch" className="inline-flex">
          <Button variant="outline">批量分析</Button>
        </Link>
      </div>
      <BluechipModePanel />
    </div>
  );
}

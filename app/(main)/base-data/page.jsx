import { BaseDataPanel } from '@/components/modules/base-data-panel';

export default function BaseDataPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold md:text-2xl">基础数据</h1>
      <BaseDataPanel />
    </div>
  );
}

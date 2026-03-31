import { Skeleton } from '@/components/ui/skeleton';

export default function StockLoading() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <Skeleton className="h-8 w-52" />
      <Skeleton className="h-44" />
      <Skeleton className="h-[460px]" />
    </div>
  );
}

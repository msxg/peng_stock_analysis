import { Skeleton } from '@/components/ui/skeleton';

export default function RootLoading() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-10 w-80" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-[420px]" />
    </div>
  );
}

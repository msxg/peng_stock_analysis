import { FocusNewsUserPanel } from '@/components/modules/focus-news-user-panel';

export default function FocusNewsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold md:text-2xl">焦点资讯</h1>
      <FocusNewsUserPanel />
    </div>
  );
}

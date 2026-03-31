import { AppSidebar } from '@/components/layout/app-sidebar';
import { AppHeader } from '@/components/layout/app-header';

export default function MainLayout({ children }) {
  return (
    <div className="grid min-h-screen md:grid-cols-[18rem_1fr]">
      <AppSidebar />
      <div className="min-w-0">
        <AppHeader />
        <main className="p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

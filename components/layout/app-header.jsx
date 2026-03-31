'use client';

import { useState } from 'react';
import { Bell, Command, LayoutGrid, Menu, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { useUIStore } from '@/stores/ui-store';

export function AppHeader() {
  const [keyword, setKeyword] = useState('');
  const router = useRouter();
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);

  function onSubmit(event) {
    event.preventDefault();
    const code = keyword.trim();
    if (!code) return;
    router.push(`/stock/${encodeURIComponent(code.toUpperCase())}`);
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/88 backdrop-blur">
      <div className="flex h-[78px] items-center justify-between gap-3 px-4 md:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button type="button" variant="outline" size="icon" className="md:hidden" onClick={toggleSidebar}>
            <Menu className="size-4" />
          </Button>

          <Button type="button" variant="outline" size="icon" className="hidden md:inline-flex">
            <LayoutGrid className="size-4" />
          </Button>

          <form onSubmit={onSubmit} className="min-w-0 flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="输入命令或按 Cmd/Ctrl + K"
                className="h-11 rounded-xl pl-9 pr-16"
              />
              <kbd className="pointer-events-none absolute right-3 top-2.5 rounded-md border border-border/80 bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                ⌘K
              </kbd>
            </div>
          </form>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button type="button" variant="outline" size="icon" aria-label="命令面板">
            <Command className="size-4" />
          </Button>
          <Button type="button" variant="outline" size="icon" aria-label="通知">
            <Bell className="size-4" />
          </Button>
          <div className="rounded-xl border border-border/70 bg-card px-3 py-2 text-sm font-semibold text-foreground">管理员</div>
        </div>
      </div>
    </header>
  );
}

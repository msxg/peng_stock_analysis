'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Bot,
  BriefcaseBusiness,
  CandlestickChart,
  ChevronDown,
  Database,
  Gauge,
  Globe,
  History,
  Import,
  Landmark,
  LineChart,
  Newspaper,
  Search,
  Settings,
  Shield,
  TrendingUp,
  X,
} from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const navGroups = [
  {
    key: 'analysis',
    label: '分析中心',
    icon: BarChart3,
    items: [
      { href: '/', label: '实时仪表盘', icon: Gauge },
      { href: '/market', label: '市场复盘', icon: Globe },
      { href: '/focus-news', label: '焦点资讯', icon: Newspaper },
      { href: '/import', label: '智能导入', icon: Import },
      { href: '/history', label: '历史与回测', icon: History },
    ],
  },
  {
    key: 'quote',
    label: '行情中心',
    icon: LineChart,
    items: [
      { href: '/futures', label: '期货监测', icon: TrendingUp },
      { href: '/stock-monitor', label: '行情监测', icon: CandlestickChart },
      { href: '/自选股', label: '自选股', icon: CandlestickChart },
      { href: '/quote-query', label: '行情查询', icon: Search },
    ],
  },
  {
    key: 'strategy',
    label: '策略与执行',
    icon: Bot,
    items: [
      { href: '/agent', label: 'Agent 问股', icon: Bot },
      { href: '/portfolio', label: '持仓管理', icon: BriefcaseBusiness },
    ],
  },
  {
    key: 'config',
    label: '系统配置',
    icon: Shield,
    items: [
      { href: '/base-data', label: '基础数据', icon: Database },
      { href: '/market-data', label: '行情数据', icon: LineChart },
      { href: '/news-data', label: '资讯数据', icon: Newspaper },
      { href: '/system', label: '系统设置', icon: Settings },
    ],
  },
];

function isRouteActive(pathname, href) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavGroups({ onNavigate }) {
  const pathname = usePathname();
  const defaultOpen = useMemo(() => {
    const openMap = {};
    navGroups.forEach((group) => {
      openMap[group.key] = true;
    });
    return openMap;
  }, []);
  const [openMap, setOpenMap] = useState(defaultOpen);

  return (
    <div className="space-y-2">
      {navGroups.map((group) => {
        const GroupIcon = group.icon;
        const hasActive = group.items.some((item) => isRouteActive(pathname, item.href));

        return (
          <section key={group.key} className="overflow-hidden rounded-2xl border border-border/70 bg-card/75">
            <button
              type="button"
              className={cn(
                'flex w-full items-center justify-between px-3 py-2 text-sm font-semibold',
                hasActive ? 'text-foreground' : 'text-muted-foreground',
              )}
              onClick={() => setOpenMap((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
            >
              <span className="inline-flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-md border border-border/70 bg-background">
                  <GroupIcon className="size-3.5" />
                </span>
                {group.label}
              </span>
              <ChevronDown className={cn('size-4 transition-transform', openMap[group.key] ? 'rotate-0' : '-rotate-90')} />
            </button>

            {openMap[group.key] ? (
              <div className="border-t border-border/60 px-2 py-2">
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const ItemIcon = item.icon;
                    const active = isRouteActive(pathname, item.href);

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onNavigate}
                        className={cn(
                          'flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                          active
                            ? 'bg-primary/12 text-primary ring-1 ring-primary/20'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        <ItemIcon className="size-4" />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

export function AppSidebar() {
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen);

  return (
    <>
      <aside className="hidden w-[292px] border-r border-border/70 bg-card/70 px-3 py-4 backdrop-blur md:block">
        <div className="mb-4 flex items-center gap-3 px-2">
          <div className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Landmark className="size-5" />
          </div>
          <div>
            <h1 className="text-[40px]/none font-bold tracking-tight">Peng Admin</h1>
            <p className="mt-1 text-sm text-muted-foreground">股票分析平台</p>
          </div>
        </div>

        <p className="mb-2 px-2 text-xs uppercase tracking-wider text-muted-foreground">导航菜单</p>
        <NavGroups />

        <div className="mt-4 rounded-xl border border-border/60 bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          服务状态由页面实时拉取显示
        </div>
      </aside>

      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden',
          sidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={() => setSidebarOpen(false)}
      />

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-[292px] border-r border-border bg-card px-3 py-3 shadow-xl transition-transform md:hidden',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="mb-2 flex items-center justify-between px-2 py-1">
          <p className="text-sm font-semibold">导航</p>
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)}>
            <X className="size-4" />
          </Button>
        </div>
        <NavGroups onNavigate={() => setSidebarOpen(false)} />
      </aside>
    </>
  );
}

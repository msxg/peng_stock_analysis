'use client';

import { MoonStar, SunMedium } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const dark = theme === 'dark';

  return (
    <Button
      variant="outline"
      size="icon"
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label="切换主题"
    >
      {dark ? <SunMedium className="size-4" /> : <MoonStar className="size-4" />}
    </Button>
  );
}

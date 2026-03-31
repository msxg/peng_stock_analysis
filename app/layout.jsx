import './globals.css';
import { AppProviders } from '@/components/providers/app-providers';

export const metadata = {
  title: 'Peng Quant - 高性能行情分析平台',
  description: 'Next.js App Router + RSC + ShadCN + Lightweight Charts 的现代化行情分析平台',
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}

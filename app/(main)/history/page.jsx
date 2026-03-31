import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function HistoryPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold md:text-2xl">历史与回测</h1>
      <Card>
        <CardHeader>
          <CardTitle>迁移说明</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>历史/回测 API 功能保持不变，当前阶段已完成新架构入口。</p>
          <p>为了保证“功能不回归”，旧版完整页面仍可直接访问后端根地址。</p>
        </CardContent>
      </Card>
    </div>
  );
}

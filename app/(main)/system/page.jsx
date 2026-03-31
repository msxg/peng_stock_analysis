import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function SystemPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold md:text-2xl">系统设置</h1>
      <Card>
        <CardHeader>
          <CardTitle>资讯数据</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>资讯数据维护能力已独立到“资讯数据”页面，包含分类目录、采集任务、调度策略与校验查询。</p>
          <div>
            <Button asChild variant="secondary">
              <Link href="/news-data">前往资讯数据</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>迁移说明</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>认证、系统配置、通知、用量统计等后端能力保持不变。</p>
          <p>本次重构先完成性能与 SEO 的前端升级，管理表单会在下一阶段继续平移到新 UI。</p>
        </CardContent>
      </Card>
    </div>
  );
}

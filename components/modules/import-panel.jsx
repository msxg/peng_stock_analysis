'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { clientApi } from '@/lib/client-api';

export function ImportPanel() {
  const [text, setText] = useState('贵州茅台\nAAPL Apple\n00700 腾讯');
  const [file, setFile] = useState(null);
  const [items, setItems] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const total = useMemo(() => (Array.isArray(items) ? items.length : 0), [items]);

  async function run(action) {
    setLoading(true);
    setMessage('');
    try {
      let payload;
      if (action === 'text') {
        payload = await clientApi.parseImportText(text);
      } else if (action === 'file') {
        if (!file) throw new Error('请先选择文件');
        payload = await clientApi.parseImportFile(file);
      } else {
        if (!file) throw new Error('请先选择图片文件');
        payload = await clientApi.extractFromImage(file);
      }

      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setMessage(`解析完成，共 ${payload?.total ?? 0} 条`);
    } catch (error) {
      setMessage(error.message || '解析失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>智能导入</CardTitle>
          <CardDescription>支持文本、CSV/Excel 与图片解析（与老版能力一致）。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="min-h-[140px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            placeholder="粘贴待导入文本"
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => run('text')} disabled={loading}>
              解析文本
            </Button>
          </div>

          <Input type="file" accept=".csv,.txt,.xls,.xlsx,.png,.jpg,.jpeg,.webp" onChange={(event) => setFile(event.target.files?.[0] || null)} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => run('file')} disabled={loading}>
              解析文件
            </Button>
            <Button variant="outline" onClick={() => run('image')} disabled={loading}>
              图片专用提取
            </Button>
          </div>

          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>解析结果</CardTitle>
          <CardDescription>共 {total} 条</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[420px] overflow-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">代码</th>
                  <th className="px-3 py-2 text-left">名称</th>
                  <th className="px-3 py-2 text-left">置信度</th>
                  <th className="px-3 py-2 text-left">等级</th>
                  <th className="px-3 py-2 text-left">来源</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={`${item.code}-${index}`} className="border-t border-border/40">
                    <td className="px-3 py-2">{item.code || '--'}</td>
                    <td className="px-3 py-2">{item.name || '--'}</td>
                    <td className="px-3 py-2">{item.confidence ?? '--'}</td>
                    <td className="px-3 py-2">{item.confidenceLevel || '--'}</td>
                    <td className="px-3 py-2">{item.source || '--'}</td>
                  </tr>
                ))}
                {!items.length ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                      暂无数据
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

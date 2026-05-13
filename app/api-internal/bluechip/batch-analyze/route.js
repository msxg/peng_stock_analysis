import { NextResponse } from 'next/server';

const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || 'http://127.0.0.1:8889';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const body = await request.text();
    const upstream = await fetch(`${BACKEND_ORIGIN}/api/v1/strategy/bluechip/batch-analyze`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Cookie: request.headers.get('cookie') || '',
      },
      body,
    });

    const payload = await upstream.text();
    return new Response(payload, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { message: error?.message || '蓝筹批量分析请求失败' },
      { status: 502 },
    );
  }
}

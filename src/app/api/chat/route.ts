import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const getJavaChatUrl = () => {
  const base = process.env.MCP_JAVA_SERVICE_BASE_URL || 'http://localhost:18081';
  return `${base.replace(/\/$/, '')}/api/chat`;
};

export async function POST(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value;
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const user = getSession(token);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const javaUrl = getJavaChatUrl();
  const bodyText = await req.text();

  const resp = await fetch(javaUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: bodyText,
  });

  return new Response(resp.body, {
    status: resp.status,
    headers: {
      'Content-Type': resp.headers.get('Content-Type') || 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}


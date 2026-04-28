import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const getJavaChatUrl = () => {
  const base = process.env.MCP_JAVA_SERVICE_BASE_URL || 'http://localhost:18081';
  return `${base.replace(/\/$/, '')}/api/chat`;
};

export async function POST(req: NextRequest) {
  const traceId = req.headers.get('x-trace-id')?.trim() || randomUUID();
  const faultInject = req.headers.get('x-fault-inject')?.trim() || '';
  const token = req.cookies.get('auth-token')?.value;
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized', traceId }), {
      status: 401,
      headers: { 'X-Trace-Id': traceId },
    });
  }
  const user = getSession(token);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized', traceId }), {
      status: 401,
      headers: { 'X-Trace-Id': traceId },
    });
  }

  const javaUrl = getJavaChatUrl();
  const bodyText = await req.text();

  const resp = await fetch(javaUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Trace-Id': traceId,
      ...(faultInject ? { 'X-Fault-Inject': faultInject } : {}),
    },
    body: bodyText,
  });

  return new Response(resp.body, {
    status: resp.status,
    headers: {
      'Content-Type': resp.headers.get('Content-Type') || 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Trace-Id': traceId,
    },
  });
}


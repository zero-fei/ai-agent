import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { randomUUID } from 'crypto';

const getJavaBaseUrl = () => {
  const toolGateway = process.env.MCP_JAVA_TOOL_GATEWAY_URL || '';
  const derived = toolGateway.replace(/\/mcp\/tool\/call\/?$/, '');
  return process.env.MCP_JAVA_SERVICE_BASE_URL || derived || 'http://localhost:18081';
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const traceId = req.headers.get('x-trace-id')?.trim() || randomUUID();
  const token = req.cookies.get('auth-token')?.value;
  if (!token) return NextResponse.json({ error: 'Unauthorized', traceId }, { status: 401, headers: { 'X-Trace-Id': traceId } });
  const user = getSession(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized', traceId }, { status: 401, headers: { 'X-Trace-Id': traceId } });

  const faultInject = req.headers.get('x-fault-inject')?.trim() || '';
  const { id } = await params;
  const javaBaseUrl = getJavaBaseUrl();
  const resp = await fetch(`${javaBaseUrl}/runs/${id}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Trace-Id': traceId,
      ...(faultInject ? { 'X-Fault-Inject': faultInject } : {}),
    },
  });
  const data = await resp.json().catch(() => null);
  return NextResponse.json(data, { status: resp.status, headers: { 'X-Trace-Id': traceId } });
}


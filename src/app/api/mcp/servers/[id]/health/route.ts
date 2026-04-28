import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { randomUUID } from 'crypto';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const getJavaBaseUrl = () => {
  const toolGateway = process.env.MCP_JAVA_TOOL_GATEWAY_URL || '';
  const derived = toolGateway.replace(/\/mcp\/tool\/call\/?$/, '');
  return process.env.MCP_JAVA_SERVICE_BASE_URL || derived || 'http://localhost:18081';
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const traceId = req.headers.get('x-trace-id')?.trim() || randomUUID();
    const faultInject = req.headers.get('x-fault-inject')?.trim() || '';
    const token = req.cookies.get('auth-token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized', traceId }, { status: 401, headers: { 'X-Trace-Id': traceId } });
    const user = getSession(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized', traceId }, { status: 401, headers: { 'X-Trace-Id': traceId } });

    const { id } = await params;
    const javaBaseUrl = getJavaBaseUrl();
    const resp = await fetch(`${javaBaseUrl}/mcp/servers/${id}/health`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Trace-Id': traceId,
        ...(faultInject ? { 'X-Fault-Inject': faultInject } : {}),
      },
    });
    const data = await resp.json().catch(() => null);
    return NextResponse.json(data, { status: resp.status, headers: { 'X-Trace-Id': traceId } });
  } catch (error: unknown) {
    const msg = getErrorMessage(error);
    const status = msg.includes('already in progress')
      ? 409
      : msg.includes('not found')
        ? 404
        : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

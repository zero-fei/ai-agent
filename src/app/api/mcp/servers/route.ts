import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { randomUUID } from 'crypto';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const getJavaBaseUrl = () => {
  const toolGateway = process.env.MCP_JAVA_TOOL_GATEWAY_URL || '';
  const derived = toolGateway.replace(/\/mcp\/tool\/call\/?$/, '');
  return process.env.MCP_JAVA_SERVICE_BASE_URL || derived || 'http://localhost:18081';
};

export async function GET(req: NextRequest) {
  try {
    const traceId = req.headers.get('x-trace-id')?.trim() || randomUUID();
    const faultInject = req.headers.get('x-fault-inject')?.trim() || '';
    const token = req.cookies.get('auth-token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized', traceId }, { status: 401, headers: { 'X-Trace-Id': traceId } });
    const user = getSession(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized', traceId }, { status: 401, headers: { 'X-Trace-Id': traceId } });

    const javaBaseUrl = getJavaBaseUrl();
    const resp = await fetch(`${javaBaseUrl}/mcp/servers`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Trace-Id': traceId,
        ...(faultInject ? { 'X-Fault-Inject': faultInject } : {}),
      },
    });
    const data = await resp.json().catch(() => null);
    return NextResponse.json(data, { status: resp.status, headers: { 'X-Trace-Id': traceId } });
  } catch (error: unknown) {
    console.error('MCP servers GET error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const traceId = req.headers.get('x-trace-id')?.trim() || randomUUID();
    const faultInject = req.headers.get('x-fault-inject')?.trim() || '';
    const token = req.cookies.get('auth-token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized', traceId }, { status: 401, headers: { 'X-Trace-Id': traceId } });
    const user = getSession(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized', traceId }, { status: 401, headers: { 'X-Trace-Id': traceId } });

    const body = (await req.json()) as {
      name?: string;
      serverKey?: string;
      endpoint?: string | null;
      config?: Record<string, unknown> | null;
    };
    const name = body?.name?.trim();
    const serverKey = body?.serverKey?.trim();
    if (!name) return NextResponse.json({ error: 'name is required', traceId }, { status: 400, headers: { 'X-Trace-Id': traceId } });
    if (!serverKey) return NextResponse.json({ error: 'serverKey is required', traceId }, { status: 400, headers: { 'X-Trace-Id': traceId } });

    const javaBaseUrl = getJavaBaseUrl();
    const resp = await fetch(`${javaBaseUrl}/mcp/servers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Trace-Id': traceId,
        ...(faultInject ? { 'X-Fault-Inject': faultInject } : {}),
      },
      body: JSON.stringify({
        name,
        serverKey,
        endpoint: body?.endpoint ?? null,
        config: body?.config ?? null,
      }),
    });
    const data = await resp.json().catch(() => null);
    return NextResponse.json(data, { status: resp.status, headers: { 'X-Trace-Id': traceId } });
  } catch (error: unknown) {
    console.error('MCP servers POST error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

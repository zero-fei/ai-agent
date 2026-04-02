import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const getJavaBaseUrl = () => {
  const toolGateway = process.env.MCP_JAVA_TOOL_GATEWAY_URL || '';
  const derived = toolGateway.replace(/\/mcp\/tool\/call\/?$/, '');
  return process.env.MCP_JAVA_SERVICE_BASE_URL || derived || 'http://localhost:18081';
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = getSession(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = (await req.json()) as {
      name?: string;
      serverKey?: string;
      endpoint?: string | null;
      config?: Record<string, unknown> | null;
      enabled?: boolean;
    };
    const javaBaseUrl = getJavaBaseUrl();
    const resp = await fetch(`${javaBaseUrl}/mcp/servers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => null);
    return NextResponse.json(data, { status: resp.status });
  } catch (error: unknown) {
    const msg = getErrorMessage(error);
    const status = msg.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = getSession(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const javaBaseUrl = getJavaBaseUrl();
    const resp = await fetch(`${javaBaseUrl}/mcp/servers/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json().catch(() => null);
    return NextResponse.json(data, { status: resp.status });
  } catch (error: unknown) {
    const msg = getErrorMessage(error);
    const status = msg.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

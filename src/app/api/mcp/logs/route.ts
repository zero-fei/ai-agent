import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Node fetch 在目标未监听时常为 TypeError: fetch failed，cause 为 ECONNREFUSED */
const isUpstreamUnreachable = (err: unknown) => {
  if (err instanceof Error && err.cause instanceof Error && 'code' in err.cause) {
    return (err.cause as NodeJS.ErrnoException).code === 'ECONNREFUSED';
  }
  return String(err).includes('ECONNREFUSED');
};

const getJavaBaseUrl = () => {
  const toolGateway = process.env.MCP_JAVA_TOOL_GATEWAY_URL || '';
  const derived = toolGateway.replace(/\/mcp\/tool\/call\/?$/, '');
  return process.env.MCP_JAVA_SERVICE_BASE_URL || derived || 'http://localhost:18081';
};

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = getSession(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const serverId = searchParams.get('serverId') || undefined;
    const limit = Number(searchParams.get('limit') || '100');

    const javaBaseUrl = getJavaBaseUrl();
    const query = new URLSearchParams();
    if (serverId) query.set('serverId', serverId);
    query.set('limit', String(Number.isFinite(limit) ? limit : 100));

    const resp = await fetch(`${javaBaseUrl}/mcp/logs?${query.toString()}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json().catch(() => null);
    return NextResponse.json(data, { status: resp.status });
  } catch (error: unknown) {
    console.error('MCP logs GET error:', error);
    if (isUpstreamUnreachable(error)) {
      return NextResponse.json(
        {
          error:
            '无法连接 Java agent-service（连接被拒绝）。请先启动 java/agent-service（默认端口 18081），或在 .env.local 中设置正确的 MCP_JAVA_SERVICE_BASE_URL。',
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

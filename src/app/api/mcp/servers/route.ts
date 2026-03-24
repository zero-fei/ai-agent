import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createServer, listServers } from '@/lib/mcp';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = getSession(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const servers = listServers(user.id);
    return NextResponse.json(servers);
  } catch (error: unknown) {
    console.error('MCP servers GET error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = getSession(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json()) as {
      name?: string;
      serverKey?: string;
      endpoint?: string | null;
      config?: Record<string, unknown> | null;
    };
    const name = body?.name?.trim();
    const serverKey = body?.serverKey?.trim();
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    if (!serverKey) return NextResponse.json({ error: 'serverKey is required' }, { status: 400 });

    const created = createServer({
      userId: user.id,
      name,
      serverKey,
      endpoint: body?.endpoint ?? null,
      config: body?.config ?? null,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error: unknown) {
    console.error('MCP servers POST error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { deleteServer, setServerEnabled, updateServer } from '@/lib/mcp';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

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

    if (typeof body.enabled === 'boolean') {
      const server = setServerEnabled({ userId: user.id, serverId: id, enabled: body.enabled });
      return NextResponse.json(server);
    }

    const server = updateServer({
      userId: user.id,
      serverId: id,
      name: body.name,
      serverKey: body.serverKey,
      endpoint: body.endpoint,
      config: body.config,
    });
    return NextResponse.json(server);
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
    const result = deleteServer({ userId: user.id, serverId: id });
    return NextResponse.json(result);
  } catch (error: unknown) {
    const msg = getErrorMessage(error);
    const status = msg.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

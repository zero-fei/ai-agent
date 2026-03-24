import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { runServerAuth } from '@/lib/mcp';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = getSession(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const result = runServerAuth({ userId: user.id, serverId: id });
    return NextResponse.json(result);
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

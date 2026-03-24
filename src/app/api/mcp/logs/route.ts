import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listLogs } from '@/lib/mcp';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = getSession(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const serverId = searchParams.get('serverId') || undefined;
    const limit = Number(searchParams.get('limit') || '100');
    const logs = listLogs({ userId: user.id, serverId, limit: Number.isFinite(limit) ? limit : 100 });
    return NextResponse.json(logs);
  } catch (error: unknown) {
    console.error('MCP logs GET error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

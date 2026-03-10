import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = getSession(token);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const stmt = db.prepare('SELECT * FROM conversations WHERE userId = ? ORDER BY createdAt DESC');
    const conversations = stmt.all(user.id);
    return NextResponse.json(conversations);
  } catch (error: unknown) {
    console.error('Failed to fetch conversations:', getErrorMessage(error));
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 });
  }
}
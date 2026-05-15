import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const MAX_BATCH = 200;

/**
 * 批量删除当前用户的会话（级联删除消息，依赖 SQLite 外键 ON DELETE CASCADE）。
 * Body: { "ids": string[] }
 */
export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = getSession(token);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json()) as { ids?: unknown };
    if (!body || !Array.isArray(body.ids) || body.ids.length === 0) {
      return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 });
    }

    const rawIds = body.ids as unknown[];
    if (rawIds.length > MAX_BATCH) {
      return NextResponse.json({ error: `At most ${MAX_BATCH} conversations per request` }, { status: 400 });
    }

    const ids = [...new Set(rawIds.map((id) => String(id ?? '').trim()).filter((id) => id.length > 0))];
    if (ids.length === 0) {
      return NextResponse.json({ error: 'No valid ids' }, { status: 400 });
    }

    const placeholders = ids.map(() => '?').join(', ');
    const sql = `DELETE FROM conversations WHERE userId = ? AND id IN (${placeholders})`;
    const stmt = db.prepare(sql);
    const result = stmt.run(user.id, ...ids);

    return NextResponse.json({ deleted: result.changes, requested: ids.length });
  } catch (error: unknown) {
    console.error('Failed to batch-delete conversations:', getErrorMessage(error));
    return NextResponse.json(
      { error: 'Failed to batch-delete conversations', detail: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

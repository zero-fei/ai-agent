import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kbDeleteCollection } from '@/lib/rag';

export const dynamic = 'force-dynamic';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * 删除集合及其内容（documents/chunks/fts）。
 *
 * 具体清理细节见 `kbDeleteCollection()`。
 */
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = getSession(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await context.params;
    const result = kbDeleteCollection({ userId: user.id, collectionId: id });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}


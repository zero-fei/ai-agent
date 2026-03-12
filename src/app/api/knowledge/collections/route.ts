import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kbCreateCollection, kbListCollections } from '@/lib/rag';

export const dynamic = 'force-dynamic';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * 集合（多知识库/多集合）API。
 *
 * - GET：列出当前用户集合
 * - POST：创建集合
 *
 * 删除由 `/api/knowledge/collections/[id]` 处理。
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = getSession(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const collections = kbListCollections(user.id);
    return NextResponse.json({ collections });
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = getSession(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json()) as { name?: string; description?: string | null };
    const name = body?.name?.trim();
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

    const result = kbCreateCollection({ userId: user.id, name, description: body?.description ?? null });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}


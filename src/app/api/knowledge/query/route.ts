import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kbSearch } from '@/lib/rag';

export const dynamic = 'force-dynamic';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * 知识库检索 API（调试/工具用）。
 *
 * 主要用于验证：
 * - 切分/向量化是否正常
 * - 检索是否能召回相关片段
 *
 * `/api/chat` 内部也是调用同一个 `kbSearch()`。
 */
export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = getSession(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json()) as { query?: string; topK?: number };
    const query = body?.query ?? '';
    const topK = typeof body?.topK === 'number' ? body.topK : 5;
    // 需要按集合调试时，可在这里增加 collectionId 入参并透传给 kbSearch。
    const hits = await kbSearch({ userId: user.id, query, topK });
    return NextResponse.json({ hits });
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}


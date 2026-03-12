import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kbListDocuments, kbUpsertFromText } from '@/lib/rag';

export const dynamic = 'force-dynamic';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * 知识库文档 API（纯文本入库 + 列表）。
 *
 * - GET：列出当前用户文档，可用 collectionId 过滤
 * - POST：将纯文本入库为新文档（切分 → 向量化 → 落库）
 *
 * 文件上传入库请使用 `/api/knowledge/upload`。
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = getSession(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    // collectionId 可选：
    // - 不传 → 默认集合（NULL）
    // - 传入 → 仅该集合
    const collectionId = searchParams.get('collectionId');
    const docs = kbListDocuments({ userId: user.id, collectionId: collectionId === null ? null : collectionId });
    return NextResponse.json({ documents: docs });
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

    const body = (await req.json()) as { name?: string; text?: string; source?: string | null; collectionId?: string | null };
    const name = body?.name?.trim();
    const text = body?.text ?? '';
    const source = body?.source ?? null;
    const collectionId = body?.collectionId ?? null;
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

    const result = await kbUpsertFromText({ userId: user.id, collectionId, name, text, source });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}


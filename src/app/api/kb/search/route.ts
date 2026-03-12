import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kbSearch } from '@/lib/rag';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

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

    const body = (await req.json()) as {
      collectionId?: string | null;
      query?: string;
      topK?: number;
      candidateK?: number;
    };
    const { collectionId = null, query, topK, candidateK } = body ?? {};

    if (!query?.trim()) {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }

    const hits = await kbSearch({
      userId: user.id,
      collectionId,
      query,
      topK,
      candidateK,
    });

    return NextResponse.json(hits);
  } catch (error: unknown) {
    console.error('KB search POST error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}


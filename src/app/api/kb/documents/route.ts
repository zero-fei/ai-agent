import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kbListDocuments, kbUpsertFromText } from '@/lib/rag';

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

    const { searchParams } = new URL(req.url);
    const collectionIdParam = searchParams.get('collectionId');
    const collectionId = collectionIdParam === 'null' ? null : collectionIdParam;

    const docs = kbListDocuments({ userId: user.id, collectionId });
    return NextResponse.json(docs);
  } catch (error: unknown) {
    console.error('KB documents GET error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

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
      name?: string;
      text?: string;
      source?: string | null;
    };
    const { collectionId = null, name, text, source = null } = body ?? {};

    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!text?.trim()) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    const result = await kbUpsertFromText({
      userId: user.id,
      collectionId,
      name: name.trim(),
      text,
      source,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    console.error('KB documents POST error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}


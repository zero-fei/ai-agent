import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import db from '@/lib/db';
import { kbDeleteCollection } from '@/lib/rag';
import { KbCollectionConfig, DEFAULT_KB_CONFIG } from '@/lib/textProcess';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = getSession(token);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = params;
    const body = (await req.json()) as { config?: Partial<KbCollectionConfig> };
    const mergedConfig: KbCollectionConfig = { ...DEFAULT_KB_CONFIG, ...(body.config ?? {}) };

    db.prepare('UPDATE kb_collections SET config = ? WHERE id = ? AND userId = ?').run(
      JSON.stringify(mergedConfig),
      id,
      user.id
    );

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error('KB collection PUT error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = getSession(token);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = params;
    const result = kbDeleteCollection({ userId: user.id, collectionId: id });
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error('KB collection DELETE error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}


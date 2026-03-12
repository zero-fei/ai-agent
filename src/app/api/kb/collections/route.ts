import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kbCreateCollection, kbListCollections } from '@/lib/rag';

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

    const collections = kbListCollections(user.id);
    return NextResponse.json(collections);
  } catch (error: unknown) {
    console.error('KB collections GET error:', error);
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

    const body = (await req.json()) as { name?: string; description?: string | null };
    const { name, description = null } = body ?? {};
    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const created = kbCreateCollection({ userId: user.id, name: name.trim(), description });
    return NextResponse.json(created, { status: 201 });
  } catch (error: unknown) {
    console.error('KB collections POST error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}


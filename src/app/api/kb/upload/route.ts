import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { extractTextFromUpload } from '@/lib/ingest';
import { kbUpsertFromText } from '@/lib/rag';

export const runtime = 'nodejs';

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

    const formData = await req.formData();
    const file = formData.get('file');
    const collectionIdRaw = formData.get('collectionId');
    const nameRaw = formData.get('name');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const text = await extractTextFromUpload({ filename: file.name, bytes });

    const collectionId =
      typeof collectionIdRaw === 'string' && collectionIdRaw !== 'null'
        ? collectionIdRaw
        : null;
    const name =
      typeof nameRaw === 'string' && nameRaw.trim()
        ? nameRaw.trim()
        : file.name;

    const result = await kbUpsertFromText({
      userId: user.id,
      collectionId,
      name,
      text,
      source: file.name,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    console.error('KB upload POST error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}


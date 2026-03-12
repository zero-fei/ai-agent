import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { kbDeleteDocument } from '@/lib/rag';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

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
    const result = kbDeleteDocument({ userId: user.id, documentId: id });
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error('KB document DELETE error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}


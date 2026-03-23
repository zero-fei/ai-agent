import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getSession } from '@/lib/auth';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = getSession(token);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: conversationId } = await params;
    
    const convStmt = db.prepare('SELECT * FROM conversations WHERE id = ? AND userId = ?');
    const conversation = convStmt.get(conversationId, user.id);
    
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    
    const stmt = db.prepare('SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC');
    const messages = stmt.all(conversationId);
    return NextResponse.json(messages);
  } catch (error: unknown) {
    console.error(`Failed to fetch messages for conversation:`, getErrorMessage(error));
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = getSession(token);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: conversationId } = await params;
    const body = (await req.json()) as { title?: unknown };
    const title = typeof body?.title === 'string' ? body.title.trim() : null;

    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const stmt = db.prepare('UPDATE conversations SET title = ? WHERE id = ? AND userId = ?');
    const result = stmt.run(title, conversationId, user.id);

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    return NextResponse.json({ id: conversationId, title }, { status: 200 });
  } catch (error: unknown) {
    console.error(`Failed to rename conversation:`, getErrorMessage(error));
    return NextResponse.json({ error: 'Failed to rename conversation' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = getSession(token);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: conversationId } = await params;

    // Foreign key `messages.conversationId` has `ON DELETE CASCADE`, so deleting
    // the conversation automatically removes its messages.
    const stmt = db.prepare('DELETE FROM conversations WHERE id = ? AND userId = ?');
    const result = stmt.run(conversationId, user.id);

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error: unknown) {
    console.error(`Failed to delete conversation:`, getErrorMessage(error));
    return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 });
  }
}
import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: conversationId } = await params;
    const stmt = db.prepare('SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC');
    const messages = stmt.all(conversationId);
    return NextResponse.json(messages);
  } catch (error: any) {
    console.error(`Failed to fetch messages for conversation:`, error);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}
import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export const dynamic = 'force-dynamic'; // Ensure the route is always dynamic

export async function GET(req: NextRequest) {
  try {
    const stmt = db.prepare('SELECT * FROM conversations ORDER BY createdAt DESC');
    const conversations = stmt.all();
    return NextResponse.json(conversations);
  } catch (error: any) {
    console.error('Failed to fetch conversations:', error);
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 });
  }
}
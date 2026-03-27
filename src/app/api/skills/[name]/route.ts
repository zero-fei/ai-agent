import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getSkillByName } from '@/lib/skills';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = getSession(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { name } = await params;
    const skill = getSkillByName(name);
    if (!skill) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    return NextResponse.json(skill);
  } catch (error: unknown) {
    console.error('Skill detail GET error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}


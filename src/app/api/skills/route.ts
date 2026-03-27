import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listSkills } from '@/lib/skills';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = getSession(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const skills = listSkills().map((s) => ({
      name: s.name,
      description: s.description,
      title: s.title,
      fileName: s.fileName,
      updatedAt: s.updatedAt,
      valid: s.valid,
      errors: s.errors,
      allowedTools: s.allowedTools,
    }));
    return NextResponse.json(skills);
  } catch (error: unknown) {
    console.error('Skills GET error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}


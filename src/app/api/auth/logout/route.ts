import { NextRequest, NextResponse } from 'next/server';
import { deleteSession } from '@/lib/auth';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('auth-token')?.value;

    if (token) {
      deleteSession(token);
    }

    const response = NextResponse.json({ success: true });

    response.cookies.delete('auth-token');

    return response;
  } catch (error: unknown) {
    console.error('Logout error:', getErrorMessage(error));
    return NextResponse.json(
      { error: '登出失败' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('auth-token')?.value;

    if (!token) {
      return NextResponse.json(
        { user: null },
        { status: 200 }
      );
    }

    const user = getSession(token);

    if (!user) {
      const response = NextResponse.json(
        { user: null },
        { status: 200 }
      );
      response.cookies.delete('auth-token');
      return response;
    }

    return NextResponse.json(
      { user },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error('Session error:', getErrorMessage(error));
    return NextResponse.json(
      { error: '获取会话失败' },
      { status: 500 }
    );
  }
}

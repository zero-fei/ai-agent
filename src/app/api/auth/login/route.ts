import { NextRequest, NextResponse } from 'next/server';
import { findUserByUsername, createSession, hashPasswordSync } from '@/lib/auth';

type LoginBody = {
  username?: string;
  password?: string;
};

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as LoginBody;
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: '用户名和密码不能为空' },
        { status: 400 }
      );
    }

    const user = findUserByUsername(username);

    if (!user) {
      return NextResponse.json(
        { error: '用户名或密码错误' },
        { status: 401 }
      );
    }

    const hashedInput = hashPasswordSync(password);
    if (hashedInput !== user.password) {
      return NextResponse.json(
        { error: '用户名或密码错误' },
        { status: 401 }
      );
    }

    const token = createSession(user.id);

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      }
    });

    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    });

    return response;
  } catch (error: unknown) {
    console.error('Login error:', getErrorMessage(error));
    return NextResponse.json(
      { error: '登录失败，请稍后重试' },
      { status: 500 }
    );
  }
}

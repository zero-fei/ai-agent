import { NextRequest, NextResponse } from 'next/server';
import { createUser, createSession, findUserByUsername, findUserByEmail } from '@/lib/auth';

type RegisterBody = {
  username?: string;
  email?: string;
  password?: string;
};

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RegisterBody;
    const { username, email, password } = body;

    if (!username || !email || !password) {
      return NextResponse.json(
        { error: '所有字段均为必填' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: '密码长度至少为 6 位' },
        { status: 400 }
      );
    }

    const existingUser = findUserByUsername(username);
    if (existingUser) {
      return NextResponse.json(
        { error: '用户名已存在' },
        { status: 400 }
      );
    }

    const existingEmail = findUserByEmail(email);
    if (existingEmail) {
      return NextResponse.json(
        { error: '邮箱已被注册' },
        { status: 400 }
      );
    }

    const user = createUser(username, email, password);

    if (!user) {
      return NextResponse.json(
        { error: '注册失败' },
        { status: 500 }
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
    console.error('Registration error:', getErrorMessage(error));
    return NextResponse.json(
      { error: '注册失败，请稍后重试' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';

// 不需要登录就能访问的路径前缀（页面或接口）。
const publicPaths = ['/auth/login', '/auth/register', '/api/auth'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 放行静态资源：public 下的文件、next 内部资源、以及常见静态文件后缀。
  // 否则会导致图片/CSS/JS 被重定向到登录页，进而出现 next/image “not a valid image”。
  if (
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    /\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|txt|woff|woff2|ttf|eot)$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (publicPaths.some(path => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const token = request.cookies.get('auth-token')?.value;

  if (!token) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // 只对“页面路由”做鉴权拦截；静态资源在 middleware 内部已放行。
    '/:path*',
  ],
};

import { NextResponse, type NextRequest } from 'next/server';

/**
 * Optimistic redirect only: it checks whether a session cookie is present, never whether it is valid. Real
 * authentication and authorization happen in every layout, page, server action and route handler
 * (`requireActor` / `requirePermission`), which validate the session against the database.
 */
const SESSION_COOKIES = ['__Secure-kachmo.session_token', 'kachmo.session_token'];

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = pathname === '/login' || pathname.startsWith('/api/auth');
  const hasSessionCookie = SESSION_COOKIES.some(name => request.cookies.has(name));

  if (!isPublic && !hasSessionCookie) {
    const url = new URL('/login', request.url);
    return NextResponse.redirect(url);
  }
  if (pathname === '/login' && hasSessionCookie) {
    return NextResponse.redirect(new URL('/', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

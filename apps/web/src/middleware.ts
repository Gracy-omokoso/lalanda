// Middleware Next.js — redirige les non-authentifiés vers /login sur les routes protégées,
// et redirige les authentifiés vers /projects s'ils tapent /login ou /register.
//
// Vérification "légère" : présence du cookie de session better-auth.
// La validation forte est faite par l'AuthGuard côté API à chaque requête `/projects/*`.

import { NextResponse, type NextRequest } from 'next/server';

// Noms de cookies possibles émis par better-auth selon la version et l'option `secureCookies`.
const SESSION_COOKIE_NAMES = ['better-auth.session_token', '__Secure-better-auth.session_token'];

function hasSession(req: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => req.cookies.get(name)?.value);
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const authed = hasSession(req);

  const isProtected = pathname.startsWith('/projects');
  const isAuthPage = pathname === '/login' || pathname === '/register';

  if (isProtected && !authed) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (isAuthPage && authed) {
    const url = req.nextUrl.clone();
    url.pathname = '/projects';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Skip static assets et les fichiers Next.js internes.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|health).*)'],
};

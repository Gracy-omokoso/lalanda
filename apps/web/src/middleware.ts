// Middleware Next.js — gère l'accès aux routes en fonction de la session better-auth.
//
// Trois catégories de routes :
//  - Publiques marketing (`/`, `/pricing`) : accessibles à tous ; si authentifié,
//    redirect vers `/projects` (l'app est plus utile qu'une plaquette).
//  - Auth (`/login`, `/register`) : si authentifié, redirect vers `/projects`.
//  - Protégées (`/projects/*`, `/members`, `/invitations/*`) : si non authentifié,
//    redirect vers `/login?next=…`.
//
// Vérification "légère" : présence du cookie de session better-auth.
// La validation forte est faite par l'AuthGuard côté API à chaque requête.

import { NextResponse, type NextRequest } from 'next/server';

// Noms de cookies possibles émis par better-auth selon la version et l'option `secureCookies`.
const SESSION_COOKIE_NAMES = ['better-auth.session_token', '__Secure-better-auth.session_token'];

// Routes publiques marketing. Un visiteur non authentifié y accède librement ;
// un utilisateur authentifié est renvoyé vers l'application.
const MARKETING_PATHS = new Set<string>(['/', '/pricing']);

// Préfixes des routes protégées. Le middleware redirige vers /login si pas de session.
const PROTECTED_PREFIXES = ['/projects', '/members', '/invitations'];

function hasSession(req: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => req.cookies.get(name)?.value);
}

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const authed = hasSession(req);

  const isMarketing = MARKETING_PATHS.has(pathname);
  const isAuthPage = pathname === '/login' || pathname === '/register';
  const isProtected = isProtectedPath(pathname);

  // Marketing : accessible à tous ; les authentifiés partent vers l'app.
  if (isMarketing && authed) {
    const url = req.nextUrl.clone();
    url.pathname = '/projects';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Protégé : non authentifié → login avec retour prévu.
  if (isProtected && !authed) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Pages d'auth : déjà authentifié → app.
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

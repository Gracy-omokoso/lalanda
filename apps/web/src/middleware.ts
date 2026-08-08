// Middleware Next.js — gère l'accès aux routes en fonction de la session better-auth.
//
// Trois catégories de routes :
//  - Publiques marketing (`/`, `/pricing`) : accessibles à tous ; si authentifié,
//    redirect vers `/projects` (l'app est plus utile qu'une plaquette).
//  - Auth (`/login`, `/register`) : si authentifié, redirect vers `/projects`.
//  - Protégées (`/projects/*`, `/members`, `/invitations/*`, `/compte/*`) : si non
//    authentifié, redirect vers `/login?next=…`.
//
// Le classement lui-même vit dans `lib/routes.ts` — logique pure, testée
// séparément : c'est le genre de liste qu'on oublie de compléter en ajoutant un
// espace, laissant des pages protégées ouvertes sans que rien ne le signale.
//
// Vérification "légère" : présence du cookie de session better-auth.
// La validation forte est faite par l'AuthGuard côté API à chaque requête.

import { NextResponse, type NextRequest } from 'next/server';

import { isAuthPath, isMarketingPath, isProtectedPath } from '@/lib/routes';

// Noms de cookies possibles émis par better-auth selon la version et l'option `secureCookies`.
const SESSION_COOKIE_NAMES = ['better-auth.session_token', '__Secure-better-auth.session_token'];

function hasSession(req: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => req.cookies.get(name)?.value);
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const authed = hasSession(req);

  // Marketing : accessible à tous ; les authentifiés partent vers l'app.
  if (isMarketingPath(pathname) && authed) {
    const url = req.nextUrl.clone();
    url.pathname = '/projects';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Protégé : non authentifié → login avec retour prévu.
  if (isProtectedPath(pathname) && !authed) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Pages d'auth : déjà authentifié → app.
  if (isAuthPath(pathname) && authed) {
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

// Middleware Next.js — gère l'accès aux routes en fonction de la session better-auth.
//
// Trois catégories de routes :
//  - Publiques marketing (`/`, `/pricing`) : accessibles à tous ; si authentifié,
//    redirect vers `/accueil` (l'app est plus utile qu'une plaquette).
//  - Auth (`/login`, `/register`) : si authentifié, redirect vers `/accueil`
//    (page d'arrivée, ADR-0038 § 5).
//  - Protégées (`/accueil`, `/initiatives/*`, `/members`, `/invitations/*`, `/compte/*`) : si non
//    authentifié, redirect vers `/login?next=…`.
//  - Console Lalanda (`/admin/*`, ADR-0053 — P1) : protégée comme ci-dessus, et
//    servie sans cache ni indexation (`CONSOLE_RESPONSE_HEADERS`).
//
// Le classement lui-même vit dans `lib/routes.ts` — logique pure, testée
// séparément : c'est le genre de liste qu'on oublie de compléter en ajoutant un
// espace, laissant des pages protégées ouvertes sans que rien ne le signale.
//
// Vérification "légère" : présence du cookie de session better-auth.
// La validation forte est faite par l'AuthGuard côté API à chaque requête.

import { NextResponse, type NextRequest } from 'next/server';

// ADR-0052 — O5 : jeton d'invitation suivi à travers la connexion ou l'inscription.
import {
  COOKIE_INVITATION,
  DUREE_COOKIE_INVITATION_S,
  jetonInvitationValide,
} from '@/lib/invitation-en-attente';
import {
  CONSOLE_RESPONSE_HEADERS,
  isAuthPath,
  isConsolePath,
  isMarketingPath,
  isProtectedPath,
  isPublicFormPath,
} from '@/lib/routes';

// Noms de cookies possibles émis par better-auth selon la version et l'option `secureCookies`.
const SESSION_COOKIE_NAMES = ['better-auth.session_token', '__Secure-better-auth.session_token'];

function hasSession(req: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => req.cookies.get(name)?.value);
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  // ADR-0048 : formulaire public de prospects — joignable sans session, et sans
  // renvoi d'un membre connecté vers l'application.
  if (isPublicFormPath(pathname)) return NextResponse.next();

  const authed = hasSession(req);

  // Marketing : accessible à tous ; les authentifiés partent vers l'app.
  if (isMarketingPath(pathname) && authed) {
    const url = req.nextUrl.clone();
    url.pathname = '/accueil';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Protégé : non authentifié → login avec retour prévu.
  if (isProtectedPath(pathname) && !authed) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    // (S22e) On repart d'une query vide, comme les deux autres branches : sans
    // cela la chaîne de requête d'origine — entièrement contrôlée par
    // l'appelant — est recopiée dans le `Location` du redirect, à côté du
    // `next` que nous posons. Rien ne la consomme aujourd'hui; le jour où
    // `/login` lira ses paramètres, la source de `next` ne serait plus
    // distinguable de ce que l'attaquant a joint.
    url.search = '';
    url.searchParams.set('next', pathname);
    const res = NextResponse.redirect(url);
    // ADR-0052 — O5 : le jeton d'invitation ne passe PAS par `next` (S22e) ; il est gardé
    // dans un cookie dédié, au format vérifié, que la bannière des invitations reprend
    // une fois la session ouverte (atterrissage dans l'organisation invitante).
    const jeton = req.nextUrl.searchParams.get('token');
    if (pathname === '/invitations/accept' && jetonInvitationValide(jeton)) {
      res.cookies.set(COOKIE_INVITATION, jeton, {
        path: '/',
        maxAge: DUREE_COOKIE_INVITATION_S,
        sameSite: 'lax',
        secure: req.nextUrl.protocol === 'https:',
      });
    }
    return res;
  }

  // Pages d'auth : déjà authentifié → app.
  if (isAuthPath(pathname) && authed) {
    const url = req.nextUrl.clone();
    url.pathname = '/accueil';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // ADR-0053 — P1 : console servie sans cache ni indexation.
  if (isConsolePath(pathname)) {
    const res = NextResponse.next();
    for (const [nom, valeur] of Object.entries(CONSOLE_RESPONSE_HEADERS)) {
      res.headers.set(nom, valeur);
    }
    return res;
  }

  return NextResponse.next();
}

export const config = {
  // Skip static assets et les fichiers Next.js internes.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|health).*)'],
};

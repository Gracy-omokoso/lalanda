// ─────────────────────────────────────────────────────────────────────────────
// EMPREINTE DE SESSION — comment on désigne « cette session-ci » sans détenir
// de quoi l'usurper.
//
// Écrit une première fois pour la ré-authentification par mot de passe
// (`integrations/reauth.service.ts`, ADR-0013 §5), puis extrait ici parce que le
// MFA en a besoin pour exactement la même raison. Deux copies d'une primitive de
// sécurité, c'est deux comportements qui divergent le jour où l'une est corrigée
// — typiquement quand un nom de cookie change et que seule la moitié du produit
// le sait.
//
// ── Ce que l'empreinte apporte, et pourquoi un `userId` ne suffirait pas ──────
//
// Une fenêtre de confiance indexée sur le seul utilisateur profiterait à TOUTES
// ses sessions : un attaquant détenant un cookie volé n'aurait qu'à attendre que
// la victime saisisse son mot de passe — ou son code TOTP — sur son propre poste
// pour hériter de la fenêtre ouverte. L'empreinte ferme cette porte : seule la
// session qui a présenté le facteur obtient la fenêtre.
//
// ── Ce qu'elle apporte en plus, sans effort ───────────────────────────────────
//
// Une session révoquée (docs/17 § S20b) ne peut pas retrouver sa fenêtre : le
// jeton change, donc l'empreinte change, donc la ligne de confiance devient
// orpheline. La révocation de session révoque de fait le second facteur, sans
// qu'aucun code n'ait à s'en charger.
//
// L'empreinte est un SHA-256 : le jeton de session vaut le cookie de connexion,
// il n'est ni stocké ni journalisé (docs/17 § S20b). Un vidage de la collection
// qui porte les empreintes ne donne rien à rejouer.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';

/**
 * Noms de cookies de session better-auth.
 *
 * Les deux formes coexistent : `__Secure-` est ajouté quand better-auth émet des
 * cookies sécurisés (production en HTTPS). La même liste vit dans
 * `apps/web/src/middleware.ts` — côté web elle ne sert qu'à un gating d'UX, ici
 * elle sert à une décision de sécurité.
 */
export const SESSION_COOKIE_NAMES = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
];

/**
 * Empreinte SHA-256 du jeton de session porté par l'en-tête `Cookie`.
 *
 * Retourne `null` si aucun cookie de session n'est présent — aucune fenêtre ne
 * peut alors être ouverte ni reconnue, ce qui est le comportement voulu : sans
 * session, il n'y a rien à lier. Les appelants doivent traiter `null` comme un
 * REFUS, jamais comme une absence de contrainte.
 */
export function sessionFingerprint(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName && SESSION_COOKIE_NAMES.includes(rawName)) {
      const value = decodeURIComponent(rest.join('=') ?? '');
      if (!value) return null;
      return createHash('sha256').update(value).digest('hex');
    }
  }
  return null;
}

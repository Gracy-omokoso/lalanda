import { Injectable, NotFoundException } from '@nestjs/common';

import { getAuth } from '../auth/auth.js';
import { describeUserAgent } from './user-agent.js';

/**
 * Sessions actives d'un utilisateur (S20b — docs/17 § Identité : « sessions révocables »).
 *
 * SOURCE DE VÉRITÉ : better-auth. Les sessions vivent dans la collection `session`
 * qu'il gère seul (schéma vérifié en base : `_id`, `token`, `userId`, `expiresAt`,
 * `createdAt`, `updatedAt`, `ipAddress`, `userAgent`). On passe par `auth.api.*`
 * plutôt que par des écritures Mongo directes : better-auth maintient aussi ses
 * caches de session, qu'une suppression brutale en base laisserait incohérents.
 *
 * RÈGLE DE SÉCURITÉ : le `token` d'une session est un SECRET D'AUTHENTIFICATION —
 * il vaut le cookie de connexion. Il ne sort JAMAIS de ce service. L'API expose un
 * `id` opaque, et la révocation résout `id → token` côté serveur. Renvoyer les
 * tokens dans la liste transformerait l'écran « sessions actives » en distributeur
 * de sessions détournables.
 *
 * ISOLATION : `auth.api.listSessions` ne retourne que les sessions du porteur des
 * en-têtes fournis. Un utilisateur ne peut donc ni voir ni révoquer la session
 * d'un autre — aucun identifiant d'utilisateur n'est accepté en entrée.
 */
@Injectable()
export class AccountSessionsService {
  /** Liste les sessions actives, la session courante marquée. Plus récente d'abord. */
  async list(headers: Headers): Promise<SessionView[]> {
    const auth = getAuth();
    const [sessions, current] = await Promise.all([
      auth.api.listSessions({ headers }) as Promise<RawSession[]>,
      auth.api.getSession({ headers }) as Promise<{ session?: { token?: string } } | null>,
    ]);

    const currentToken = current?.session?.token ?? null;

    return sessions
      .map((s) => toView(s, currentToken))
      .sort((a, b) => {
        // La session courante reste en tête : c'est celle que l'utilisateur doit
        // reconnaître avant de révoquer quoi que ce soit.
        if (a.current !== b.current) return a.current ? -1 : 1;
        return Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt);
      });
  }

  /**
   * Révoque UNE session par son id opaque.
   *
   * L'id est résolu contre la liste des sessions de l'appelant : un id appartenant
   * à un autre utilisateur est simplement introuvable ici et produit un 404. La
   * portée est donc garantie par construction, sans contrôle d'appartenance
   * séparé qu'on pourrait oublier d'écrire.
   */
  async revoke(
    headers: Headers,
    sessionId: string,
  ): Promise<{ revoked: number; wasCurrent: boolean }> {
    const auth = getAuth();
    const sessions = (await auth.api.listSessions({ headers })) as RawSession[];
    const target = sessions.find((s) => idOf(s) === sessionId);
    if (!target) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: "Cette session n'existe pas ou ne vous appartient pas.",
      });
    }

    const current = (await auth.api.getSession({ headers })) as {
      session?: { token?: string };
    } | null;
    const wasCurrent = Boolean(current?.session?.token && current.session.token === target.token);

    await auth.api.revokeSession({ body: { token: target.token }, headers });
    return { revoked: 1, wasCurrent };
  }

  /**
   * Révoque toutes les sessions SAUF la courante — l'utilisateur reste connecté
   * là où il est en train d'agir. C'est le geste attendu après un appareil perdu.
   */
  async revokeOthers(headers: Headers): Promise<{ revoked: number }> {
    const auth = getAuth();
    // Compté AVANT révocation : better-auth ne retourne pas le nombre supprimé.
    const before = (await auth.api.listSessions({ headers })) as RawSession[];
    await auth.api.revokeOtherSessions({ headers });
    return { revoked: Math.max(0, before.length - 1) };
  }
}

/** Forme renvoyée par `auth.api.listSessions` (vérifiée contre la collection `session`). */
interface RawSession {
  id?: string;
  _id?: unknown;
  token: string;
  expiresAt: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Vue publique d'une session — SANS token (cf. règle de sécurité du service). */
export interface SessionView {
  id: string;
  /** Libellé d'appareil dérivé du User-Agent, jamais vide. */
  device: string;
  browser: string | null;
  os: string | null;
  /** `null` si better-auth n'a pas capté d'adresse (appel hors réseau public). */
  ipAddress: string | null;
  createdAt: string;
  /** `session.updatedAt` : better-auth le rafraîchit à chaque prolongation. */
  lastActiveAt: string;
  expiresAt: string;
  /** Vrai pour la session qui a émis la requête courante. */
  current: boolean;
}

function idOf(s: RawSession): string {
  return String(s.id ?? s._id ?? '');
}

function toView(s: RawSession, currentToken: string | null): SessionView {
  const device = describeUserAgent(s.userAgent);
  const ip = (s.ipAddress ?? '').trim();
  return {
    id: idOf(s),
    device: device.label,
    browser: device.browser,
    os: device.os,
    ipAddress: ip.length > 0 ? ip : null,
    createdAt: new Date(s.createdAt).toISOString(),
    lastActiveAt: new Date(s.updatedAt).toISOString(),
    expiresAt: new Date(s.expiresAt).toISOString(),
    current: currentToken !== null && s.token === currentToken,
  };
}

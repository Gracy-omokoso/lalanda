// Quels moyens de connexion sont disponibles (S22a).
//
//   GET /auth-providers  →  { "google": true|false }
//
// POURQUOI UNE ROUTE PLUTÔT QU'UNE VARIABLE `NEXT_PUBLIC_GOOGLE_ENABLED` :
// le front doit afficher le bouton « Continuer avec Google » exactement quand
// l'API sait le traiter. Une variable côté web serait une SECONDE source de
// vérité — et la panne classique qui en découle est un bouton affiché vers un
// fournisseur non configuré, c'est-à-dire une page d'erreur au clic. Ici, la
// réponse est dérivée de la configuration réellement chargée par better-auth :
// il n'y a rien à tenir synchronisé.
//
// ROUTE PUBLIQUE, ET ELLE PEUT L'ÊTRE : elle est consultée par la page de
// connexion, donc avant toute session. Elle ne divulgue rien — le bouton lui-même
// annoncerait la même information à n'importe quel visiteur. Elle ne renvoie
// SURTOUT PAS le `clientId` : ce n'est pas un secret au sens strict, mais il n'a
// aucune utilité côté navigateur (la redirection OAuth est construite par l'API)
// et le publier ne ferait qu'ouvrir la porte à des applications tierces qui
// usurpent l'identité visuelle de la nôtre.
//
// Elle n'est pas montée sous `/auth/*` : ce préfixe appartient entièrement au
// handler better-auth (voir main.ts), qui répondrait 404 sur un chemin inconnu.

import { Controller, Get } from '@nestjs/common';

import { resolveGoogleCredentials } from './auth.js';

export interface AuthProvidersView {
  /** Vrai si la connexion Google est configurée et utilisable. */
  google: boolean;
}

@Controller('auth-providers')
export class AuthProvidersController {
  @Get()
  list(): AuthProvidersView {
    return { google: resolveGoogleCredentials(process.env) !== null };
  }
}

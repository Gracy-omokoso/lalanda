// ─────────────────────────────────────────────────────────────────────────────
// `GET /me/platform-access` — ce que l'INTERFACE a le droit d'afficher (S21b)
//
// ── Pourquoi cette route n'est pas sous `/admin` ──────────────────────────────
//
// Tout `/admin/*` exige déjà un rôle plateforme. Une route d'accès placée là
// répondrait 403 à l'écrasante majorité des utilisateurs — c'est-à-dire à ceux
// qui ont précisément besoin de savoir qu'ils n'ont aucun rôle. Le header de
// l'application interroge cette route sur chaque page : un 403 systématique
// remplirait les journaux de refus qui ne signalent rien, et le jour où un vrai
// refus surviendrait, personne ne le verrait.
//
// Elle vit donc sous `/me`, aux côtés de `GET /me/permissions`, avec la même
// justification : lire ses PROPRES droits ne peut pas exiger un droit, sous
// peine de circularité. Elle est scopée par la session et ne prend aucun
// identifiant.
//
// ── Ce que cette route ne fait pas ────────────────────────────────────────────
//
// Elle n'AUTORISE rien. « Côté web, l'autorisation n'est jamais décidée par le
// client » (docs/12) : masquer un onglet est un confort, et le serveur refuse de
// toute façon. Un utilisateur qui forcerait `/admin/integrations` dans sa barre
// d'adresse verrait la page se monter puis l'API répondre 403.
//
// `forbiddenActions` est renvoyé pour être AFFICHÉ, pas pour être interprété :
// l'espace admin annonce en clair que valider un plan, clôturer une période et
// exporter un rapport restent hors de portée de tous les rôles plateforme
// (ADR-0012 §4). Une capacité absente sans explication passe pour un bug et
// finit par être « corrigée ».
// ─────────────────────────────────────────────────────────────────────────────

import { Controller, Get, Inject, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AuthzService } from '../authz/authz.service.js';
import {
  PLATFORM_FORBIDDEN_ACTIONS,
  PLATFORM_ROLE_LABELS,
  type Action,
  type PlatformRole,
} from '../authz/permissions.js';

/** Rôles ouvrant la CONSULTATION de `/admin` — miroir du plancher d'AdminController. */
export const ADMIN_READ_ROLES: readonly PlatformRole[] = [
  'platform_super_admin',
  'platform_admin',
  'platform_support',
];

export interface PlatformAccessView {
  roles: Array<{ role: PlatformRole; label: string }>;
  /** Détient-il au moins un rôle plateforme ? Décide de l'entrée « Admin » du header. */
  isPlatformOperator: boolean;
  /** Peut-il ouvrir `/admin` ? */
  canReadAdmin: boolean;
  /** Peut-il gérer les organisations et les comptes (ADR-0012 §4) ? */
  canManagePlatform: boolean;
  /** Peut-il écrire un secret d'intégration ? `platform_super_admin` uniquement. */
  canManageIntegrations: boolean;
  /** Les trois interdits absolus, pour affichage — jamais pour décision. */
  forbiddenActions: Action[];
}

@Controller('me')
@UseGuards(AuthGuard)
export class PlatformAccessController {
  constructor(@Inject(AuthzService) private readonly authz: AuthzService) {}

  @Get('platform-access')
  async platformAccess(@CurrentUser() user: { id: string }): Promise<PlatformAccessView> {
    const roles = await this.authz.platformRolesOf(user.id);
    return {
      roles: roles.map((role) => ({ role, label: PLATFORM_ROLE_LABELS[role] })),
      isPlatformOperator: roles.length > 0,
      canReadAdmin: roles.some((role) => ADMIN_READ_ROLES.includes(role)),
      canManagePlatform: roles.some(
        (role) => role === 'platform_super_admin' || role === 'platform_admin',
      ),
      canManageIntegrations: roles.includes('platform_super_admin'),
      forbiddenActions: [...PLATFORM_FORBIDDEN_ACTIONS],
    };
  }
}

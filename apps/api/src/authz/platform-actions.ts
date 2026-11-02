// ─────────────────────────────────────────────────────────────────────────────
// RBAC DE LA CONSOLE LALANDA (ADR-0053 — P0)
//
// Catalogue des actions plateforme, matrice rôle plateforme × action plateforme et
// fonctions de décision pures de la séparation des tâches (§ 5).
//
// ── Pourquoi un fichier distinct de `permissions.ts` ──────────────────────────
//
// 1. Deux vocabulaires qui ne se croisent jamais. Une action plateforme porte sur une
//    ressource de Lalanda (comptes, abonnements, annonces, journal plateforme) ; une
//    action d'organisation porte sur le contenu d'un client. Aucun rôle d'organisation
//    ne détient d'action plateforme, aucun rôle plateforme ne gagne d'action
//    d'organisation par ce fichier (`PLATFORM_PERMISSION_MATRIX` reste la vérité de
//    l'accès délégué futur).
// 2. `permissions.ts` est la zone de conflit de tous les ADR qui ajoutent des actions
//    d'organisation ; la console n'y entre pas (ADR-0053, zones de conflit).
//
// ── Ce que ce fichier ne fait pas ─────────────────────────────────────────────
//
// Il ne lit rien. Les fonctions de décision reçoivent des FAITS déjà lus (appartenance
// de l'opérateur à l'organisation cible, nombre de détenteurs effectifs d'une action)
// et jugent des PERSONNES ; la détention de l'action de route est vérifiée en amont par
// `PermissionsGuard`. Aucun `if (role === …)` : tout passe par la matrice.
// ─────────────────────────────────────────────────────────────────────────────

import {
  PLATFORM_ACTIONS,
  PLATFORM_LIMITS,
  sortPlatformActions,
  type PlatformAction,
} from '@lalanda/shared/platform';
import type { Plan } from '@lalanda/shared/pricing';

import { PLATFORM_ROLES, type PlatformRole } from './permissions.js';

export { PLATFORM_ACTIONS, isPlatformAction, type PlatformAction } from '@lalanda/shared/platform';

/**
 * Case de la matrice plateforme. `allow_sod` (ⓢ) : l'action est détenue, mais son
 * exercice passe par une fonction de séparation des tâches (§ 5.3).
 */
export type PlatformActionGrant = 'allow' | 'allow_sod' | 'deny';

const Y = 'allow' as const;
const S = 'allow_sod' as const;
const N = 'deny' as const;

/**
 * Transcription LITTÉRALE d'ADR-0053 § 5.2 (SA, PA, SUP, FAC, TPL, CPK), action par
 * action, dans l'ordre du tableau. 6 × 21 = 126 cases. Toute modification est un
 * changement d'ADR (décision ouverte n° 7) et doit faire rougir `platform-actions.test.ts`.
 */
const ROWS: Readonly<Record<PlatformAction, readonly PlatformActionGrant[]>> = {
  //                                   SA PA SUP FAC TPL CPK
  'platform.console.read': [Y, Y, Y, Y, Y, Y],
  'platform.orgs.read': [Y, Y, Y, Y, N, N],
  'platform.orgs.suspend': [Y, Y, N, N, N, N],
  'platform.users.read': [Y, Y, Y, N, N, N],
  'platform.users.block': [Y, Y, N, N, N, N],
  'platform.roles.manage': [Y, N, N, N, N, N],
  'platform.billing.read': [Y, Y, N, Y, N, N],
  'platform.billing.confirm': [Y, N, N, Y, N, N],
  'platform.billing.grant': [Y, S, N, S, N, N],
  'platform.features.read': [Y, Y, Y, Y, N, N],
  'platform.features.override': [Y, Y, N, N, N, N],
  'platform.integrations.manage': [Y, N, N, N, N, N],
  'platform.audit.read': [Y, Y, N, N, N, N],
  'platform.audit.export': [Y, N, N, N, N, N],
  'platform.announcements.draft': [Y, Y, N, N, N, N],
  'platform.announcements.approve': [S, S, N, N, N, N],
  'platform.stats.read': [Y, Y, N, Y, N, N],
  'platform.finance.read': [Y, N, N, Y, N, N],
  'platform.finance.export': [Y, N, N, Y, N, N],
  'platform.packs.manage': [N, N, N, N, N, Y],
  'platform.templates.manage': [N, N, N, N, Y, N],
};

/** Ordre des colonnes de `ROWS` : celui d'ADR-0053 § 5.2, égal à `PLATFORM_ROLES`. */
const COLUMNS: readonly PlatformRole[] = [
  'platform_super_admin',
  'platform_admin',
  'platform_support',
  'platform_billing',
  'platform_template_editor',
  'platform_country_pack_manager',
];

/** MATRICE RÔLE PLATEFORME × ACTION PLATEFORME (ADR-0053 § 5.2). */
export const PLATFORM_ACTION_MATRIX: Readonly<
  Record<PlatformRole, Readonly<Record<PlatformAction, PlatformActionGrant>>>
> = Object.freeze(
  Object.fromEntries(
    PLATFORM_ROLES.map((role) => {
      const column = COLUMNS.indexOf(role);
      return [
        role,
        Object.freeze(
          Object.fromEntries(PLATFORM_ACTIONS.map((action) => [action, ROWS[action][column]!])),
        ),
      ];
    }),
  ),
) as Readonly<Record<PlatformRole, Readonly<Record<PlatformAction, PlatformActionGrant>>>>;

/**
 * Un rôle plateforme détient-il l'action (case ✓ ou ⓢ) ? Un rôle ou une action hors
 * vocabulaire (rôle d'organisation passé par erreur, action d'organisation) : refus.
 */
export function canPlatformAction(role: PlatformRole, action: PlatformAction): boolean {
  const cell = (
    PLATFORM_ACTION_MATRIX as Partial<Record<string, Partial<Record<string, PlatformActionGrant>>>>
  )[role]?.[action];
  return cell === 'allow' || cell === 'allow_sod';
}

/** Un opérateur peut détenir plusieurs rôles : l'un suffit. */
export function canAnyPlatformAction(
  roles: readonly PlatformRole[],
  action: PlatformAction,
): boolean {
  return roles.some((role) => canPlatformAction(role, action));
}

/** Actions plateforme détenues par un ensemble de rôles, dans l'ordre du catalogue. */
export function platformActionsOf(roles: readonly PlatformRole[]): PlatformAction[] {
  return sortPlatformActions(PLATFORM_ACTIONS.filter((a) => canAnyPlatformAction(roles, a)));
}

/** Rôles détenteurs d'une action, dans l'ordre de `PLATFORM_ROLES`. */
export function platformActionHolders(action: PlatformAction): PlatformRole[] {
  return PLATFORM_ROLES.filter((role) => canPlatformAction(role, action));
}

// ─────────────────────────────────────────────────────────────────────────────
// Séparation des tâches (ADR-0053 § 2.6, § 5.3)
// ─────────────────────────────────────────────────────────────────────────────
//
// Motif de `contractApprovalDecision` : chaque fonction rend un résultat typé que le
// service traduit en réponse HTTP. L'exception de l'opérateur ou de l'approbateur
// UNIQUE (un seul détenteur effectif de l'action sur toute la plateforme — cas de la
// dirigeante seule) est toujours MARQUÉE, jamais silencieuse.

/** Gestes concernés par le contrôle de conflit d'intérêts (§ 2.6). */
export const PLATFORM_SELF_DEALING_GESTURES = [
  'billing.confirm',
  'billing.grant',
  'features.override',
  'orgs.suspend',
  'orgs.restore',
] as const;
export type PlatformSelfDealingGesture = (typeof PLATFORM_SELF_DEALING_GESTURES)[number];

export interface PlatformSelfDealingInput {
  readonly gesture: PlatformSelfDealingGesture;
  /** L'opérateur est-il membre (appartenance active) de l'organisation CIBLE ? */
  readonly actorIsMemberOfTarget: boolean;
  /** Détenteurs effectifs de l'action du geste sur la plateforme (rôles non révoqués, non expirés). */
  readonly holdersCount: number;
}

export type PlatformSelfDealingDecision =
  | { readonly ok: false; readonly code: 'PLATFORM_SELF_DEALING' }
  | { readonly ok: true; readonly soleOperator: boolean };

/**
 * § 2.6 — un opérateur MEMBRE de l'organisation cible ne confirme pas son paiement, ne
 * change pas son offre, n'accorde pas de dérogation, ne suspend ni ne lève sa suspension
 * (`409 PLATFORM_SELF_DEALING`). Exception unique : il est le seul détenteur de l'action ;
 * le geste est alors marqué `soleOperator: true` (journal plateforme et miroir).
 */
export function platformSelfDealingDecision(
  input: PlatformSelfDealingInput,
): PlatformSelfDealingDecision {
  if (!input.actorIsMemberOfTarget) return { ok: true, soleOperator: false };
  if (input.holdersCount <= 1) return { ok: true, soleOperator: true };
  return { ok: false, code: 'PLATFORM_SELF_DEALING' };
}

export interface BroadcastApprovalInput {
  readonly approverUserId: string;
  readonly createdBy: string;
  /** Qui a soumis le brouillon à l'approbation (`null` si encore brouillon). */
  readonly submittedBy: string | null;
  /** Détenteurs effectifs de `platform.announcements.approve`. */
  readonly holdersCount: number;
}

export type BroadcastApprovalDecision =
  | { readonly ok: false; readonly code: 'SELF_APPROVAL_FORBIDDEN' }
  | { readonly ok: true; readonly soleApprover: boolean };

/**
 * § 5.3 — l'auteur d'une annonce (ou celui qui l'a soumise) ne l'approuve pas : deux
 * personnes. Exception `soleApprover` si un seul détenteur effectif de
 * `platform.announcements.approve`, marquée.
 */
export function broadcastApprovalDecision(
  input: BroadcastApprovalInput,
): BroadcastApprovalDecision {
  const isSelf =
    input.createdBy === input.approverUserId || input.submittedBy === input.approverUserId;
  if (!isSelf) return { ok: true, soleApprover: false };
  if (input.holdersCount <= 1) return { ok: true, soleApprover: true };
  return { ok: false, code: 'SELF_APPROVAL_FORBIDDEN' };
}

export interface PlatformGrantInput {
  readonly plan: Plan;
  readonly startsAt: Date;
  /** `null` : octroi sans échéance — traité comme « au-delà de 90 jours ». */
  readonly endsAt: Date | null;
  /** Qui a préparé l'octroi. */
  readonly requestedBy: string;
  /** Qui l'approuve maintenant ; `null` à la création. */
  readonly approverUserId: string | null;
  /** Détenteurs effectifs de `platform.billing.grant`. */
  readonly holdersCount: number;
}

export type PlatformGrantDecision =
  | { readonly ok: false; readonly code: 'SELF_APPROVAL_FORBIDDEN' }
  | { readonly ok: true; readonly status: 'pending_approval' }
  | { readonly ok: true; readonly status: 'active'; readonly soleApprover: boolean };

/** L'octroi exige-t-il une seconde personne (§ 5.3) ? Offre Expert, ou plus de 90 jours. */
export function platformGrantNeedsSecondPerson(
  plan: Plan,
  startsAt: Date,
  endsAt: Date | null,
): boolean {
  if (plan === 'expert') return true;
  if (endsAt === null) return true;
  const days = (endsAt.getTime() - startsAt.getTime()) / 86_400_000;
  return days > PLATFORM_LIMITS.grantSecondPersonDays;
}

/**
 * § 5.3 — un octroi manuel au-delà de 90 jours, ou de l'offre Expert, exige une seconde
 * personne détentrice de `platform.billing.grant`. À la création (`approverUserId`
 * nul) il reste `pending_approval` ; son auteur ne l'approuve pas. Exception
 * approbateur unique : un seul détenteur, octroi actif et marqué `soleApprover`.
 */
export function platformGrantDecision(input: PlatformGrantInput): PlatformGrantDecision {
  if (!platformGrantNeedsSecondPerson(input.plan, input.startsAt, input.endsAt)) {
    return { ok: true, status: 'active', soleApprover: false };
  }
  if (input.holdersCount <= 1) return { ok: true, status: 'active', soleApprover: true };
  if (input.approverUserId === null) return { ok: true, status: 'pending_approval' };
  if (input.approverUserId === input.requestedBy) {
    return { ok: false, code: 'SELF_APPROVAL_FORBIDDEN' };
  }
  return { ok: true, status: 'active', soleApprover: false };
}

export type PlatformRoleGrantDecision =
  { readonly ok: false; readonly code: 'SELF_GRANT_FORBIDDEN' } | { readonly ok: true };

/**
 * § 5.3 — jamais d'attribution d'un rôle plateforme à soi-même (s'ajoute à
 * `SELF_DEMOTION_FORBIDDEN`). Le motif obligatoire et l'échéance du Support sont jugés
 * par le schéma (`grantPlatformRoleInputSchema`).
 */
export function platformRoleGrantDecision(input: {
  readonly actorUserId: string;
  readonly targetUserId: string;
}): PlatformRoleGrantDecision {
  if (input.actorUserId === input.targetUserId) return { ok: false, code: 'SELF_GRANT_FORBIDDEN' };
  return { ok: true };
}

export type AnnouncementSendDecision =
  | { readonly ok: false; readonly code: 'AUDIENCE_COUNT_MISMATCH' }
  | { readonly ok: false; readonly code: 'REAPPROVAL_REQUIRED' }
  | { readonly ok: true };

/**
 * § 6.6 — l'envoi exige de RETAPER le nombre de destinataires approuvé ; le nombre est
 * recalculé à l'envoi et un écart de plus de 10 % renvoie à l'approbation.
 */
export function announcementSendDecision(input: {
  readonly confirmedAudienceCount: number;
  readonly audienceCountAtApproval: number;
  readonly recountedAudienceCount: number;
}): AnnouncementSendDecision {
  if (input.confirmedAudienceCount !== input.audienceCountAtApproval) {
    return { ok: false, code: 'AUDIENCE_COUNT_MISMATCH' };
  }
  const base = Math.max(input.audienceCountAtApproval, 1);
  const drift = Math.abs(input.recountedAudienceCount - input.audienceCountAtApproval) / base;
  if (drift > PLATFORM_LIMITS.announcementRecountTolerance) {
    return { ok: false, code: 'REAPPROVAL_REQUIRED' };
  }
  return { ok: true };
}

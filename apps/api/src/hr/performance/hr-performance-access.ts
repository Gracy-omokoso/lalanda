// Qui voit quoi dans les objectifs et les évaluations (ADR-0051 § 4). ADR-0051 — H15.
//
// Routes RELATIONNELLES : `analytics.read` au guard, décision ici sur les droits
// EFFECTIFS du membre (rôle, ajouts, retraits résolus par `PermissionsGuard`) et sur la
// RELATION à la fiche, jamais sur un rôle :
//   - `self` : la fiche reliée à l'appelant ;
//   - `chain` : l'appelant est le compte d'un manager de la chaîne, jusqu'à
//     `performance.managerChainDepth` niveaux (1 = manager direct seul, défaut) ;
//   - `perf` : l'appelant détient `performance.read` (Propriétaire, Responsable RH).
// `hr.read` seul, `hr.sensitive.read` seul, l'Administrateur et le Directeur financier
// n'ont AUCUNE relation : 404 (on ne confirme pas l'existence d'un objectif ni d'une
// évaluation). `performance.read` est un interdit absolu de la plateforme.

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import type { CurrentOrgPermissionsValue } from '../../authz/current-org-permissions.decorator.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import type { EmployeeLean } from '../employees/employee.schema.js';
import { HrScopeService, type HrViewer } from '../scope/hr-scope.service.js';
import {
  HrPerformanceSettingsService,
  type HrPerformanceSettingsView,
} from './hr-performance-settings.service.js';

export interface PerformanceViewer {
  viewer: HrViewer;
  settings: HrPerformanceSettingsView;
  userId: string;
  role: string;
  selfEmployeeId: string | null;
  perf: boolean;
  hrManage: boolean;
}

export interface PerformanceRelation {
  self: boolean;
  chain: boolean;
  perf: boolean;
}

/**
 * Comptes des managers d'un collaborateur, du direct au N+`depth`. Une boucle (donnée
 * corrompue) est coupée ; un manager sans compte ou anonymisé est sauté sans arrêter la
 * remontée (son propre manager reste dans la chaîne au niveau suivant).
 */
export function chainManagerUserIds(
  byId: ReadonlyMap<string, EmployeeLean>,
  employeeId: string,
  depth: number,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>([employeeId]);
  let current = byId.get(employeeId) ?? null;
  for (let level = 0; level < depth && current; level += 1) {
    const managerId = current.managerEmployeeId ?? null;
    if (managerId === null || seen.has(managerId)) break;
    seen.add(managerId);
    const manager = byId.get(managerId) ?? null;
    if (!manager) break;
    if (manager.status !== 'anonymized' && manager.userId) out.push(manager.userId);
    current = manager;
  }
  return out;
}

/** Compte du manager DIRECT (destinataire d'une proposition d'objectif), s'il en a un. */
export function directManagerUserId(
  byId: ReadonlyMap<string, EmployeeLean>,
  employeeId: string,
): string | null {
  return chainManagerUserIds(byId, employeeId, 1)[0] ?? null;
}

export function employeeName(e: EmployeeLean): string {
  return e.preferredName ?? `${e.firstName} ${e.lastName}`;
}

/** Corps ou requête contrôlés par un schéma zod ; `400` sinon. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) invalidRequest(r.error);
  return r.data;
}

export function goalNotFound(): never {
  throw new NotFoundException({ code: 'GOAL_NOT_FOUND', message: 'Objectif introuvable.' });
}

export function reviewNotFound(): never {
  throw new NotFoundException({ code: 'REVIEW_NOT_FOUND', message: 'Évaluation introuvable.' });
}

export function reviewCycleNotFound(): never {
  throw new NotFoundException({
    code: 'REVIEW_CYCLE_NOT_FOUND',
    message: 'Campagne d’évaluation introuvable.',
  });
}

@Injectable()
export class HrPerformanceAccess {
  constructor(
    @Inject(HrScopeService) private readonly scope: HrScopeService,
    @Inject(HrPerformanceSettingsService)
    private readonly settings: HrPerformanceSettingsService,
  ) {}

  /** Lecteur des routes du lot ; lève `409 HR_FEATURE_DISABLED` si éteint. */
  async viewerOf(
    organizationId: string,
    userId: string,
    role: string | undefined,
    perms: CurrentOrgPermissionsValue | undefined,
  ): Promise<PerformanceViewer> {
    const settings = await this.settings.requireEnabled(organizationId);
    const viewer = await this.scope.viewerOf(organizationId, userId, perms);
    return {
      viewer,
      settings,
      userId,
      role: role ?? 'unknown',
      selfEmployeeId: viewer.scope.selfEmployeeId ?? null,
      perf: viewer.actions.has('performance.read'),
      hrManage: viewer.actions.has('hr.manage'),
    };
  }

  /** Relation à une fiche ; `null` = hors portée (404). */
  relationTo(pv: PerformanceViewer, employeeId: string): PerformanceRelation | null {
    const employee = pv.viewer.byId.get(employeeId);
    if (!employee) return null;
    const self = pv.selfEmployeeId === employeeId;
    const chain = chainManagerUserIds(
      pv.viewer.byId,
      employeeId,
      pv.settings.managerChainDepth,
    ).includes(pv.userId);
    if (!self && !chain && !pv.perf) return null;
    return { self, chain, perf: pv.perf };
  }

  /** Fiches visibles (liste) : toutes avec `performance.read`, sinon soi et la chaîne. */
  visibleEmployeeIds(pv: PerformanceViewer): string[] | 'all' {
    if (pv.perf) return 'all';
    const ids: string[] = [];
    for (const id of pv.viewer.byId.keys()) {
      if (this.relationTo(pv, id) !== null) ids.push(id);
    }
    return ids;
  }
}

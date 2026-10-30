// Portée relationnelle d'un lecteur sur les RH (ADR-0045 § 4.4). ADR-0045 — H2.
//
// Les routes relationnelles (fiche, « moi », « mon équipe », organigramme, données
// sensibles pour soi) portent `analytics.read` au guard ; la décision de portée est
// prise ICI, par la fonction pure du moteur `hrViewerScope`, à partir des droits
// EFFECTIFS du membre (rôle, ajouts, retraits résolus par `PermissionsGuard`), jamais
// d'un `if (role === …)`. Un collaborateur hors portée rend 404.
//
// Le lien `userId` d'un compte qui a quitté l'organisation est inerte : le guard a
// déjà vérifié l'appartenance de l'appelant à chaque requête.

import { hrViewerScope, type HrEmployeeInput, type HrViewerScope } from '@lalanda/engine';
import type { HrSettingsView, HrViewerRelation } from '@lalanda/shared/hr';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import type { CurrentOrgPermissionsValue } from '../../authz/current-org-permissions.decorator.js';
import { effectiveActions, type Action, type OrgRole } from '../../authz/permissions.js';
import {
  Employee,
  type EmployeeDocument,
  type EmployeeLean,
} from '../employees/employee.schema.js';
import { HrSettingsService } from '../settings/hr-settings.service.js';

export interface HrViewer {
  userId: string;
  role: OrgRole | null;
  actions: ReadonlySet<Action>;
  scope: HrViewerScope;
  settings: HrSettingsView;
  /** Toutes les fiches de l'organisation (anonymisées comprises). */
  employees: readonly EmployeeLean[];
  byId: ReadonlyMap<string, EmployeeLean>;
}

/** Entrée du moteur pour une fiche (aucune donnée sensible). */
export function engineEmployeeOf(e: EmployeeLean): HrEmployeeInput {
  return {
    id: String(e._id),
    userId: e.userId ?? null,
    status: e.status,
    startDate: e.startDate,
    endDate: e.endDate ?? null,
    probationEndDate: e.probationEndDate ?? null,
    contractEndDate: e.contractEndDate ?? null,
    contractType: e.contractType,
    departmentId: e.departmentId ?? null,
    managerEmployeeId: e.managerEmployeeId ?? null,
    workPattern: e.workPattern ?? null,
    exitCategory: e.exitCategory ?? null,
    sortName: e.sortName,
  };
}

@Injectable()
export class HrScopeService {
  constructor(
    @InjectModel(Employee.name) private readonly employees: Model<EmployeeDocument>,
    @Inject(HrSettingsService) private readonly settings: HrSettingsService,
  ) {}

  async viewerOf(
    organizationId: string,
    userId: string,
    perms: CurrentOrgPermissionsValue | undefined,
  ): Promise<HrViewer> {
    const [employees, settings] = await Promise.all([
      this.employees.find({ organizationId }).lean<EmployeeLean[]>().exec(),
      this.settings.view(organizationId),
    ]);
    // Sans droits résolus (route mal câblée, accès délégué), moindre privilège : aucun.
    const actions = new Set<Action>(perms ? effectiveActions(perms.role, perms.context) : []);
    const scope = hrViewerScope({
      viewerUserId: userId,
      employees: employees.map(engineEmployeeOf),
      effectiveActions: [...actions],
      settings: {
        teamCalendarVisibility: settings.teamCalendarVisibility,
        orgChartVisibility: settings.orgChartVisibility,
      },
    });
    return {
      userId,
      role: perms?.role ?? null,
      actions,
      scope,
      settings,
      employees,
      byId: new Map(employees.map((e) => [String(e._id), e])),
    };
  }

  /**
   * Relation du lecteur à une fiche : `hr` (`hr.read`), `self`, `manager` (équipe
   * directe ou indirecte), ou `null` (hors portée → 404).
   */
  relationTo(viewer: HrViewer, employeeId: string): HrViewerRelation | null {
    if (!viewer.byId.has(employeeId)) return null;
    if (viewer.actions.has('hr.read')) return 'hr';
    if (viewer.scope.selfEmployeeId === employeeId) return 'self';
    if (viewer.scope.teamEmployeeIds.includes(employeeId)) return 'manager';
    return null;
  }
}

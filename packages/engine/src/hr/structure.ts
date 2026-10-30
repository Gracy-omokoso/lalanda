// ─────────────────────────────────────────────────────────────────────────────
// Circuit de validation, hiérarchie, services, organigramme, portée
// (ADR-0045 § 2.1, § 2.3, § 2.7, § 4.4, § 7)
//
// - `leaveApprovalSteps` : étapes figées à la soumission ; l'étape `manager`
//   est remplacée par `hr` sans manager, sans compte du manager, ou pour un type
//   confidentiel (validé par les RH seules, le manager est informé).
// - `reportingCycle`, `departmentCycle` : refus des cycles (`409 MANAGER_CYCLE`,
//   `DEPARTMENT_CYCLE`, `DEPARTMENT_TOO_DEEP`).
// - `orgChart` : arbres calculés, jamais stockés ; seuls les collaborateurs
//   `active` y figurent.
// - `hrViewerScope` : portée relationnelle (soi, équipe, service) et drapeaux
//   tirés des droits EFFECTIFS ; aucune lecture de rôle.
// ─────────────────────────────────────────────────────────────────────────────

import { byString, checkId } from './days.js';
import {
  DEPARTMENT_MAX_DEPTH,
  HR_VERSION,
  TEAM_MAX_DEPTH,
  type ApprovalFlow,
  type DepartmentChartNode,
  type DepartmentCycleResult,
  type DepartmentInput,
  type HrEmployeeInput,
  type HrViewerScope,
  type HrViewerSettings,
  type LeaveApprovalStep,
  type LeaveApprovalStepsResult,
  type OrgChartResult,
  type ReportingChartNode,
  type ReportingCycleResult,
} from './types.js';

const APPROVAL_FLOWS: readonly ApprovalFlow[] = ['manager_only', 'manager_then_hr', 'hr_only'];

/**
 * Étapes de validation d'une demande (ADR-0045 § 2.7) : `manager_only` →
 * `['manager']` (+ `hr` si le type l'exige), `manager_then_hr` →
 * `['manager', 'hr']`, `hr_only` → `['hr']`. L'étape `manager` devient `hr`
 * sans manager désigné, si le manager n'a pas de compte, ou pour un type
 * confidentiel ; les doublons sont fusionnés.
 */
export function leaveApprovalSteps(
  settings: { approvalFlow: ApprovalFlow },
  type: { confidential: boolean; requiresHrApproval: boolean },
  employee: { managerEmployeeId: string | null; managerUserId: string | null },
): LeaveApprovalStepsResult {
  if (!APPROVAL_FLOWS.includes(settings.approvalFlow)) {
    throw new RangeError(`Circuit inconnu ${JSON.stringify(settings.approvalFlow)}`);
  }
  let steps: LeaveApprovalStep[];
  if (settings.approvalFlow === 'hr_only') steps = ['hr'];
  else if (settings.approvalFlow === 'manager_then_hr' || type.requiresHrApproval) {
    steps = ['manager', 'hr'];
  } else steps = ['manager'];

  let managerReplacedBy: LeaveApprovalStepsResult['managerReplacedBy'] = null;
  if (settings.approvalFlow === 'hr_only') managerReplacedBy = 'HR_ONLY_FLOW';
  else if (type.confidential) managerReplacedBy = 'CONFIDENTIAL_TYPE';
  else if (employee.managerEmployeeId === null) managerReplacedBy = 'NO_MANAGER';
  else if (employee.managerUserId === null) managerReplacedBy = 'MANAGER_WITHOUT_ACCOUNT';

  if (managerReplacedBy !== null) steps = ['hr'];
  return { version: HR_VERSION, steps, managerReplacedBy };
}

/**
 * Faire de `managerId` le manager de `employeeId` crée-t-il un cycle ? Vrai si
 * `managerId` est `employeeId` lui-même ou l'un de ses subordonnés (directs ou
 * indirects). Un cycle déjà présent dans les données ne boucle pas.
 */
export function reportingCycle(
  employees: readonly Pick<HrEmployeeInput, 'id' | 'managerEmployeeId'>[],
  employeeId: string,
  managerId: string | null,
): ReportingCycleResult {
  checkId(employeeId, 'Collaborateur');
  if (managerId === null) return { version: HR_VERSION, cycle: false };
  checkId(managerId, 'Manager');
  const managerOf = new Map(employees.map((e) => [e.id, e.managerEmployeeId ?? null]));
  const seen = new Set<string>();
  let current: string | null = managerId;
  while (current !== null && !seen.has(current)) {
    if (current === employeeId) return { version: HR_VERSION, cycle: true };
    seen.add(current);
    current = managerOf.get(current) ?? null;
  }
  return { version: HR_VERSION, cycle: false };
}

/**
 * Rattacher `departmentId` (ou un service nouveau si `null`) à `parentId` :
 * cycle si le parent est le service lui-même ou un de ses descendants ;
 * profondeur = profondeur du parent + hauteur du sous-arbre déplacé (racine =
 * 1), au plus 8.
 */
export function departmentCycle(
  departments: readonly Pick<DepartmentInput, 'id' | 'parentId'>[],
  departmentId: string | null,
  parentId: string | null,
): DepartmentCycleResult {
  const parentOf = new Map(departments.map((d) => [d.id, d.parentId]));
  const childrenOf = new Map<string, string[]>();
  for (const d of departments) {
    if (d.parentId === null) continue;
    const list = childrenOf.get(d.parentId) ?? [];
    list.push(d.id);
    childrenOf.set(d.parentId, list);
  }
  // Hauteur du sous-arbre déplacé.
  let height = 1;
  if (departmentId !== null) {
    checkId(departmentId, 'Service');
    const seen = new Set<string>([departmentId]);
    let level = [departmentId];
    while (level.length > 0) {
      const next: string[] = [];
      for (const id of level) {
        for (const c of childrenOf.get(id) ?? []) {
          if (!seen.has(c)) {
            seen.add(c);
            next.push(c);
          }
        }
      }
      if (next.length > 0) height += 1;
      level = next;
    }
  }
  if (parentId === null) {
    return {
      version: HR_VERSION,
      cycle: false,
      depth: height,
      tooDeep: height > DEPARTMENT_MAX_DEPTH,
    };
  }
  checkId(parentId, 'Service parent');
  let depth = 0;
  const seen = new Set<string>();
  let current: string | null = parentId;
  while (current !== null && !seen.has(current)) {
    if (current === departmentId) {
      return { version: HR_VERSION, cycle: true, depth: 0, tooDeep: false };
    }
    seen.add(current);
    depth += 1;
    current = parentOf.get(current) ?? null;
  }
  const total = depth + height;
  return { version: HR_VERSION, cycle: false, depth: total, tooDeep: total > DEPARTMENT_MAX_DEPTH };
}

const sortKey = (e: Pick<HrEmployeeInput, 'id' | 'sortName'>): string => e.sortName ?? e.id;
const byEmployee = (
  a: Pick<HrEmployeeInput, 'id' | 'sortName'>,
  b: Pick<HrEmployeeInput, 'id' | 'sortName'>,
): number => byString(sortKey(a), sortKey(b)) || byString(a.id, b.id);

/**
 * Organigramme (ADR-0045 § 2.3) : par `departments` (arbre des services actifs,
 * effectifs directs et cumulés) ou par `reporting` (arbre des managers ;
 * racines = sans manager actif). Collaborateurs `exited` et `anonymized` exclus.
 */
export function orgChart(
  departments: readonly DepartmentInput[],
  employees: readonly HrEmployeeInput[],
  view: 'departments' | 'reporting',
): OrgChartResult {
  const active = employees.filter((e) => e.status === 'active').sort(byEmployee);
  if (view === 'departments') {
    const live = departments.filter((d) => d.active);
    const liveIds = new Set(live.map((d) => d.id));
    const byDept = new Map<string, string[]>();
    const unassigned: string[] = [];
    for (const e of active) {
      const d = e.departmentId ?? null;
      if (d === null || !liveIds.has(d)) unassigned.push(e.id);
      else byDept.set(d, [...(byDept.get(d) ?? []), e.id]);
    }
    const childrenOf = new Map<string | null, DepartmentInput[]>();
    for (const d of live) {
      const parent = d.parentId !== null && liveIds.has(d.parentId) ? d.parentId : null;
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), d]);
    }
    const visited = new Set<string>();
    const build = (d: DepartmentInput): DepartmentChartNode => {
      visited.add(d.id);
      const children = (childrenOf.get(d.id) ?? [])
        .filter((c) => !visited.has(c.id))
        .sort((a, b) => byString(a.name, b.name) || byString(a.id, b.id))
        .map(build);
      const employeeIds = byDept.get(d.id) ?? [];
      return {
        departmentId: d.id,
        name: d.name,
        headEmployeeId: d.headEmployeeId ?? null,
        employeeIds,
        headcount: employeeIds.length,
        totalHeadcount: employeeIds.length + children.reduce((s, c) => s + c.totalHeadcount, 0),
        children,
      };
    };
    const roots = [...(childrenOf.get(null) ?? [])]
      .sort((a, b) => byString(a.name, b.name) || byString(a.id, b.id))
      .map(build);
    // Un cycle de services (données corrompues) n'est atteint par aucune
    // racine : son premier service, dans l'ordre des noms, devient racine.
    for (const d of [...live].sort((a, b) => byString(a.name, b.name) || byString(a.id, b.id))) {
      if (!visited.has(d.id)) roots.push(build(d));
    }
    return {
      version: HR_VERSION,
      view,
      roots,
      unassignedEmployeeIds: unassigned,
      headcount: active.length,
    };
  }

  const activeIds = new Set(active.map((e) => e.id));
  const reportsOf = new Map<string | null, HrEmployeeInput[]>();
  for (const e of active) {
    const m = e.managerEmployeeId ?? null;
    const parent = m !== null && activeIds.has(m) && m !== e.id ? m : null;
    reportsOf.set(parent, [...(reportsOf.get(parent) ?? []), e]);
  }
  const visited = new Set<string>();
  const build = (e: HrEmployeeInput): ReportingChartNode => {
    visited.add(e.id);
    const children = (reportsOf.get(e.id) ?? []).filter((c) => !visited.has(c.id)).map(build);
    return {
      employeeId: e.id,
      departmentId: e.departmentId ?? null,
      directReports: children.length,
      totalReports: children.reduce((s, c) => s + 1 + c.totalReports, 0),
      children,
    };
  };
  const roots = (reportsOf.get(null) ?? []).map(build);
  const cycleBrokenAt: string[] = [];
  for (const e of active) {
    if (!visited.has(e.id)) {
      cycleBrokenAt.push(e.id);
      roots.push(build(e));
    }
  }
  return { version: HR_VERSION, view, roots, headcount: active.length, cycleBrokenAt };
}

/**
 * Portée d'un lecteur sur les RH (ADR-0045 § 4.4). `effectiveActions` : droits
 * EFFECTIFS du membre (rôle, ajouts, retraits déjà résolus par l'appelant).
 * L'équipe d'un manager = subordonnés actifs directs et indirects (profondeur
 * ≤ 10) ; le service = collègues actifs du même service (soi exclu).
 */
export function hrViewerScope(args: {
  viewerUserId: string;
  employees: readonly HrEmployeeInput[];
  effectiveActions: readonly string[];
  settings: HrViewerSettings;
}): HrViewerScope {
  const { viewerUserId, employees, effectiveActions, settings } = args;
  checkId(viewerUserId, 'Utilisateur');
  const actions = new Set(effectiveActions);
  const seesAll = actions.has('hr.read');
  const seesConfidential = actions.has('hr.sensitive.read');
  const holdsLeaveApprove = actions.has('leave.approve');

  const self =
    employees.find((e) => e.status !== 'anonymized' && (e.userId ?? null) === viewerUserId) ?? null;
  const active = employees.filter((e) => e.status === 'active').sort(byEmployee);
  const reportsOf = new Map<string, string[]>();
  for (const e of active) {
    const m = e.managerEmployeeId ?? null;
    if (m === null || m === e.id) continue;
    reportsOf.set(m, [...(reportsOf.get(m) ?? []), e.id]);
  }

  const directReportIds = self === null ? [] : [...(reportsOf.get(self.id) ?? [])];
  const team: string[] = [];
  if (self !== null) {
    const seen = new Set<string>([self.id]);
    let level = [self.id];
    for (let depth = 1; depth <= TEAM_MAX_DEPTH && level.length > 0; depth += 1) {
      const next: string[] = [];
      for (const id of level) {
        for (const r of reportsOf.get(id) ?? []) {
          if (seen.has(r)) continue;
          seen.add(r);
          next.push(r);
          team.push(r);
        }
      }
      level = next;
    }
  }
  const selfDept = self?.departmentId ?? null;
  const departmentEmployeeIds =
    self === null || selfDept === null
      ? []
      : active.filter((e) => e.id !== self.id && e.departmentId === selfDept).map((e) => e.id);

  const allActive = active.map((e) => e.id);
  const own = self === null ? [] : [self.id];
  let calendar: string[];
  if (seesAll || settings.teamCalendarVisibility === 'organization') calendar = allActive;
  else if (settings.teamCalendarVisibility === 'department') {
    calendar = [...own, ...team, ...departmentEmployeeIds];
  } else calendar = [...own, ...team];
  const uniq = (ids: readonly string[]): string[] => [...new Set(ids)].sort(byString);

  return {
    version: HR_VERSION,
    selfEmployeeId: self?.id ?? null,
    directReportIds: uniq(directReportIds),
    teamEmployeeIds: uniq(team),
    departmentEmployeeIds: uniq(departmentEmployeeIds),
    seesAll,
    seesConfidential,
    holdsLeaveApprove,
    isManager: directReportIds.length > 0,
    calendarEmployeeIds: uniq(calendar),
    pendingVisibleEmployeeIds: uniq(seesAll ? allActive : [...own, ...team]),
    orgChartVisible: seesAll || (settings.orgChartVisibility === 'members' && self !== null),
  };
}

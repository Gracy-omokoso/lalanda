// Services (ADR-0045 § 2.3) — logique pure de la liste et du formulaire, lot H6.
//
// L'arbre est affiché tel que les rattachements le donnent ; cycles et profondeur
// (huit niveaux) sont jugés par l'API (`409 DEPARTMENT_CYCLE`, `DEPARTMENT_TOO_DEEP`).
// Le formulaire ne propose simplement pas, comme parent, le service lui-même ni
// ses sous-services.

import { HR_LIMITS } from '@lalanda/shared/hr';

import type { HrDepartmentInput, HrDepartmentView } from '@/lib/api-hr';

export interface LigneService {
  service: HrDepartmentView;
  niveau: number;
}

/**
 * Services à plat, chaque parent suivi de ses enfants (par nom), avec leur niveau
 * (0 = racine). Un service dont le parent n'est pas dans la liste est une racine.
 */
export function arbreServices(services: readonly HrDepartmentView[]): LigneService[] {
  const ids = new Set(services.map((s) => s.id));
  const enfants = new Map<string | null, HrDepartmentView[]>();
  for (const s of services) {
    const parent = s.parentId !== null && ids.has(s.parentId) ? s.parentId : null;
    enfants.set(parent, [...(enfants.get(parent) ?? []), s]);
  }
  for (const l of enfants.values()) l.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const sortie: LigneService[] = [];
  const vus = new Set<string>();
  const parcourir = (parent: string | null, niveau: number): void => {
    for (const s of enfants.get(parent) ?? []) {
      if (vus.has(s.id)) continue;
      vus.add(s.id);
      sortie.push({ service: s, niveau });
      parcourir(s.id, niveau + 1);
    }
  };
  parcourir(null, 0);
  // Un cycle déjà en base ne doit rien faire disparaître : le reste en racines.
  for (const s of services) if (!vus.has(s.id)) sortie.push({ service: s, niveau: 0 });
  return sortie;
}

/** Descendants d'un service (sous-services, à toute profondeur). */
export function descendants(services: readonly HrDepartmentView[], id: string): Set<string> {
  const res = new Set<string>();
  let front = [id];
  while (front.length > 0) {
    const suivants = services.filter(
      (s) => s.parentId !== null && front.includes(s.parentId) && !res.has(s.id),
    );
    for (const s of suivants) res.add(s.id);
    front = suivants.map((s) => s.id);
  }
  return res;
}

/** Parents proposés : services actifs, sauf le service lui-même et ses sous-services. */
export function parentsPossibles(
  services: readonly HrDepartmentView[],
  selfId: string | null,
): HrDepartmentView[] {
  const exclus = selfId === null ? new Set<string>() : descendants(services, selfId);
  if (selfId !== null) exclus.add(selfId);
  return services
    .filter((s) => s.active && !exclus.has(s.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export interface FormService {
  name: string;
  parentId: string;
  headEmployeeId: string;
}

export function formService(s: HrDepartmentView | null): FormService {
  return {
    name: s?.name ?? '',
    parentId: s?.parentId ?? '',
    headEmployeeId: s?.headEmployeeId ?? '',
  };
}

export function validerService(
  f: FormService,
): { ok: true; corps: HrDepartmentInput } | { ok: false; erreur: string } {
  const name = f.name.trim();
  if (name === '') return { ok: false, erreur: 'Le nom du service est obligatoire.' };
  if (name.length > HR_LIMITS.departmentName) {
    return { ok: false, erreur: `${HR_LIMITS.departmentName} caractères au plus.` };
  }
  return {
    ok: true,
    corps: {
      name,
      parentId: f.parentId === '' ? null : f.parentId,
      headEmployeeId: f.headEmployeeId === '' ? null : f.headEmployeeId,
    },
  };
}

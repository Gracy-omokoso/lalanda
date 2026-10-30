// Organigramme (ADR-0045 § 2.3, moteur `orgChart`) — logique pure, lot H6.
//
// Deux vues rendues par l'API : par SERVICES (arbre des services, effectifs) et
// par LIGNE HIÉRARCHIQUE (arbre des managers). On n'y lit que nom d'usage, poste,
// service et manager — rien d'autre. Les effectifs sont ceux du moteur.
//
// L'arbre suit le motif ARIA « tree » : focus itinérant (un seul élément dans
// l'ordre de tabulation), flèches haut et bas pour se déplacer, droite pour
// déplier ou descendre, gauche pour replier ou remonter, Début et Fin, `*` pour
// déplier les frères. Toute cette logique est ici, testée sans DOM.

import type {
  HrDepartmentChartNode,
  HrOrgChartPerson,
  HrOrgChartResponse,
  HrReportingChartNode,
} from '@/lib/api-hr';

export interface NoeudArbre {
  /** Unique dans l'arbre (`s:` service, `p:` personne). */
  id: string;
  type: 'service' | 'personne';
  titre: string;
  detail: string | null;
  /** Lien vers la fiche, si l'appelant peut la lire. */
  lien: string | null;
  enfants: NoeudArbre[];
}

function pluriel(n: number, mot: string): string {
  return `${n} ${mot}${n > 1 ? 's' : ''}`;
}

function personneNoeud(
  p: HrOrgChartPerson | undefined,
  employeeId: string,
  lien: (id: string) => string | null,
  detailsEnPlus: string[] = [],
  enfants: NoeudArbre[] = [],
): NoeudArbre {
  const detail = [p?.jobTitle, ...detailsEnPlus].filter(Boolean).join(' · ');
  return {
    id: `p:${employeeId}`,
    type: 'personne',
    titre: p?.name ?? 'Collaborateur',
    detail: detail || null,
    lien: lien(employeeId),
    enfants,
  };
}

/**
 * Arbre affichable à partir de la réponse de l'API. `lien` rend l'adresse d'une
 * fiche si l'appelant peut l'ouvrir (`hr.read`), sinon `null` : l'organigramme
 * se lit sans ouvrir les dossiers.
 */
export function arbreOrganigramme(
  r: HrOrgChartResponse,
  lien: (employeeId: string) => string | null = () => null,
): NoeudArbre[] {
  const personnes = new Map((r.people ?? []).map((p) => [p.id, p]));
  if (r.view === 'departments') {
    const service = (n: HrDepartmentChartNode): NoeudArbre => {
      const responsable = n.headEmployeeId ? personnes.get(n.headEmployeeId)?.name : null;
      const membres = n.employeeIds
        .filter((id) => personnes.has(id))
        .map((id) => personneNoeud(personnes.get(id), id, lien))
        .sort((a, b) => a.titre.localeCompare(b.titre, 'fr'));
      return {
        id: `s:${n.departmentId}`,
        type: 'service',
        titre: n.name,
        detail: [
          responsable ? `Responsable : ${responsable}` : null,
          n.totalHeadcount === n.headcount
            ? pluriel(n.headcount, 'personne')
            : `${pluriel(n.headcount, 'personne')}, ${n.totalHeadcount} avec les sous-services`,
        ]
          .filter(Boolean)
          .join(' · '),
        lien: null,
        enfants: [...n.children.map(service), ...membres],
      };
    };
    const racines = r.roots.map(service);
    if (r.unassignedEmployeeIds.length > 0) {
      racines.push({
        id: 's:sans-service',
        type: 'service',
        titre: 'Sans service',
        detail: pluriel(r.unassignedEmployeeIds.length, 'personne'),
        lien: null,
        enfants: r.unassignedEmployeeIds
          .filter((id) => personnes.has(id))
          .map((id) => personneNoeud(personnes.get(id), id, lien)),
      });
    }
    return racines;
  }
  const personne = (n: HrReportingChartNode): NoeudArbre => {
    const p = personnes.get(n.employeeId) ?? {
      id: n.employeeId,
      name: n.name ?? 'Collaborateur',
      jobTitle: n.jobTitle ?? null,
    };
    const service = p.departmentName ?? null;
    const equipe =
      n.totalReports > 0
        ? n.totalReports === n.directReports
          ? `encadre ${pluriel(n.directReports, 'personne')}`
          : `encadre ${n.directReports} en direct, ${n.totalReports} en tout`
        : null;
    return personneNoeud(
      p,
      n.employeeId,
      lien,
      [service, equipe].filter((x): x is string => x !== null),
      n.children.map(personne),
    );
  };
  return r.roots.map(personne);
}

// ── Arbre au clavier ────────────────────────────────────────────────────────

export interface NoeudVisible {
  noeud: NoeudArbre;
  niveau: number;
  parentId: string | null;
  /** Position parmi ses frères (1…) et nombre de frères (ARIA). */
  position: number;
  freres: number;
}

/** Nœuds visibles, dans l'ordre de lecture, selon les nœuds dépliés. */
export function noeudsVisibles(
  racines: readonly NoeudArbre[],
  ouverts: ReadonlySet<string>,
): NoeudVisible[] {
  const sortie: NoeudVisible[] = [];
  const parcourir = (
    liste: readonly NoeudArbre[],
    niveau: number,
    parentId: string | null,
  ): void => {
    liste.forEach((noeud, i) => {
      sortie.push({ noeud, niveau, parentId, position: i + 1, freres: liste.length });
      if (noeud.enfants.length > 0 && ouverts.has(noeud.id)) {
        parcourir(noeud.enfants, niveau + 1, noeud.id);
      }
    });
  };
  parcourir(racines, 1, null);
  return sortie;
}

/** Dépliés au départ : les racines (le premier niveau se lit sans clic). */
export function ouvertsInitiaux(racines: readonly NoeudArbre[]): Set<string> {
  return new Set(racines.filter((n) => n.enfants.length > 0).map((n) => n.id));
}

/** Tous les nœuds qui ont des enfants (« Tout déplier »). */
export function tousLesParents(racines: readonly NoeudArbre[]): Set<string> {
  const res = new Set<string>();
  const parcourir = (l: readonly NoeudArbre[]): void => {
    for (const n of l) {
      if (n.enfants.length > 0) {
        res.add(n.id);
        parcourir(n.enfants);
      }
    }
  };
  parcourir(racines);
  return res;
}

export interface EtatArbre {
  focus: string | null;
  ouverts: Set<string>;
}

/**
 * Effet d'une touche sur l'arbre (motif ARIA « tree »). Rend `null` si la touche
 * ne concerne pas l'arbre (le navigateur garde son comportement).
 */
export function toucheArbre(
  key: string,
  visibles: readonly NoeudVisible[],
  etat: EtatArbre,
): EtatArbre | null {
  if (visibles.length === 0) return null;
  const i = Math.max(
    0,
    visibles.findIndex((v) => v.noeud.id === etat.focus),
  );
  const courant = visibles[i]!;
  const aEnfants = courant.noeud.enfants.length > 0;
  const ouvert = etat.ouverts.has(courant.noeud.id);
  const focus = (id: string): EtatArbre => ({ focus: id, ouverts: etat.ouverts });
  switch (key) {
    case 'ArrowDown':
      return focus(visibles[Math.min(i + 1, visibles.length - 1)]!.noeud.id);
    case 'ArrowUp':
      return focus(visibles[Math.max(i - 1, 0)]!.noeud.id);
    case 'Home':
      return focus(visibles[0]!.noeud.id);
    case 'End':
      return focus(visibles[visibles.length - 1]!.noeud.id);
    case 'ArrowRight':
      if (!aEnfants) return etat;
      if (!ouvert) {
        return { focus: courant.noeud.id, ouverts: new Set([...etat.ouverts, courant.noeud.id]) };
      }
      return focus(courant.noeud.enfants[0]!.id);
    case 'ArrowLeft': {
      if (aEnfants && ouvert) {
        const o = new Set(etat.ouverts);
        o.delete(courant.noeud.id);
        return { focus: courant.noeud.id, ouverts: o };
      }
      return courant.parentId ? focus(courant.parentId) : etat;
    }
    case '*': {
      const freres = visibles.filter(
        (v) => v.parentId === courant.parentId && v.noeud.enfants.length > 0,
      );
      return {
        focus: courant.noeud.id,
        ouverts: new Set([...etat.ouverts, ...freres.map((v) => v.noeud.id)]),
      };
    }
    default:
      return null;
  }
}

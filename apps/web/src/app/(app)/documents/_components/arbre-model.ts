// Arbre des dossiers et droits par dossier (ADR-0046 § 4.1 ; lot S9). Logique pure,
// testée.
//
// L'arbre servi par l'API est DÉJÀ filtré par les droits (un dossier restreint
// n'apparaît pas, nom compris) : ici on ne fait que le ranger. Un dossier dont le
// parent est invisible remonte à la racine plutôt que de disparaître. Les droits se
// lisent sur les droits EFFECTIFS et les personnes, jamais sur un rôle.

import type { OrgAction } from '@/lib/api';
import type {
  CreateDocumentFolderBody,
  DocumentFolderAccessInput,
  DocumentFolderView,
} from '@/lib/api-documents';

export interface NoeudDossier {
  dossier: DocumentFolderView;
  enfants: NoeudDossier[];
}

const parNom = (x: NoeudDossier, y: NoeudDossier): number =>
  x.dossier.name.localeCompare(y.dossier.name, 'fr', { sensitivity: 'base' });

/** Range la liste plate en arbre ; dossiers archivés exclus sauf demande. */
export function arbreDossiers(
  dossiers: readonly DocumentFolderView[],
  avecArchives = false,
): NoeudDossier[] {
  const gardes = dossiers.filter((d) => avecArchives || d.status === 'active');
  const noeuds = new Map<string, NoeudDossier>(
    gardes.map((d) => [d.id, { dossier: d, enfants: [] }]),
  );
  const racines: NoeudDossier[] = [];
  for (const n of noeuds.values()) {
    const parent = n.dossier.parentId ? noeuds.get(n.dossier.parentId) : undefined;
    if (parent && parent !== n) parent.enfants.push(n);
    else racines.push(n);
  }
  const trier = (liste: NoeudDossier[]): NoeudDossier[] => {
    liste.sort(parNom);
    for (const n of liste) trier(n.enfants);
    return liste;
  };
  return trier(racines);
}

/** Chemin d'un dossier, de la racine à lui (dossiers visibles seulement). */
export function cheminDossier(
  dossiers: readonly DocumentFolderView[],
  id: string | null,
): DocumentFolderView[] {
  const parId = new Map(dossiers.map((d) => [d.id, d]));
  const chemin: DocumentFolderView[] = [];
  const vus = new Set<string>();
  let courant = id ? parId.get(id) : undefined;
  while (courant && !vus.has(courant.id)) {
    vus.add(courant.id);
    chemin.unshift(courant);
    courant = courant.parentId ? parId.get(courant.parentId) : undefined;
  }
  return chemin;
}

/** Options d'un choix de dossier, indentées ; `ecriture` : seulement ceux où l'on dépose. */
export function optionsDossiers(
  dossiers: readonly DocumentFolderView[],
  ecriture: boolean,
): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const parcourir = (noeuds: NoeudDossier[], profondeur: number): void => {
    for (const n of noeuds) {
      if (!ecriture || n.dossier.canWrite) {
        out.push({ id: n.dossier.id, label: `${' '.repeat(profondeur * 2)}${n.dossier.name}` });
      }
      parcourir(n.enfants, profondeur + 1);
    }
  };
  parcourir(arbreDossiers(dossiers), 0);
  return out;
}

/** Sous-dossiers d'un dossier (pour ne pas proposer un parent qui créerait un cycle). */
export function descendants(dossiers: readonly DocumentFolderView[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let ajoute = true;
  while (ajoute) {
    ajoute = false;
    for (const d of dossiers) {
      if (d.parentId && out.has(d.parentId) && !out.has(d.id)) {
        out.add(d.id);
        ajoute = true;
      }
    }
  }
  return out;
}

// ── Droits lisibles ─────────────────────────────────────────────────────────

const LIBELLES_ACTIONS: Partial<Record<OrgAction, string>> = {
  'treasury.read': 'la trésorerie',
  'purchase.read': 'les achats',
  'sales.read': 'les ventes',
  'hr.read': 'les ressources humaines',
  'docs.manage': 'la gestion des documents',
};

/** « Lecture : … · Écriture : … » d'un dossier, en français. */
export function resumeAcces(
  acces: DocumentFolderAccessInput,
  nom: (userId: string) => string,
): { lecture: string; ecriture: string; restreint: boolean } {
  const r = acces.read;
  const lecture =
    r === 'all'
      ? 'tous ceux qui consultent la bibliothèque'
      : 'action' in r
        ? `ceux qui voient ${LIBELLES_ACTIONS[r.action as OrgAction] ?? r.action}`
        : `${r.userIds.map(nom).join(', ')} (dossier restreint)`;
  const w = acces.write;
  const ecriture =
    w === 'managers'
      ? 'les gestionnaires des documents'
      : `les gestionnaires et ${w.userIds.map(nom).join(', ')}`;
  return { lecture, ecriture, restreint: r !== 'all' && 'userIds' in r };
}

// ── Formulaire de dossier ───────────────────────────────────────────────────

export type TypeLecture = 'all' | 'action' | 'users';

export interface FormulaireDossier {
  name: string;
  parentId: string;
  lecture: TypeLecture;
  action: string;
  lecteurs: string[];
  ecrivains: string[];
  inherit: boolean;
}

/** Natures proposées pour un dossier « réservé par nature » (§ 4.1). */
export const ACTIONS_DOSSIER: readonly { action: OrgAction; label: string }[] = [
  { action: 'treasury.read', label: 'Trésorerie (fiscal, administratif)' },
  { action: 'purchase.read', label: 'Achats' },
  { action: 'sales.read', label: 'Ventes' },
  { action: 'docs.manage', label: 'Gestionnaires des documents' },
];

export function formulaireDossier(d: DocumentFolderView | null, parent: string): FormulaireDossier {
  const r = d?.access.read ?? 'all';
  const w = d?.access.write ?? 'managers';
  return {
    name: d?.name ?? '',
    parentId: d ? (d.parentId ?? '') : parent,
    lecture: r === 'all' ? 'all' : 'action' in r ? 'action' : 'users',
    action: r !== 'all' && 'action' in r ? r.action : 'treasury.read',
    lecteurs: r !== 'all' && 'userIds' in r ? [...r.userIds] : [],
    ecrivains: w === 'managers' ? [] : [...w.userIds],
    inherit: d?.access.inherit ?? true,
  };
}

export function preparerDossier(
  f: FormulaireDossier,
): { ok: true; corps: CreateDocumentFolderBody } | { ok: false; champs: Record<string, string> } {
  const champs: Record<string, string> = {};
  if (f.name.trim() === '') champs['name'] = 'Le nom est obligatoire.';
  if (f.lecture === 'users' && f.lecteurs.length === 0) {
    champs['lecteurs'] = 'Choisissez au moins une personne.';
  }
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  const read: DocumentFolderAccessInput['read'] =
    f.lecture === 'all'
      ? 'all'
      : f.lecture === 'action'
        ? { action: f.action }
        : { userIds: [...new Set(f.lecteurs)] };
  const write: DocumentFolderAccessInput['write'] =
    f.ecrivains.length === 0 ? 'managers' : { userIds: [...new Set(f.ecrivains)] };
  return {
    ok: true,
    corps: {
      name: f.name.trim(),
      parentId: f.parentId === '' ? null : f.parentId,
      access: { read, write, inherit: f.inherit },
    },
  };
}

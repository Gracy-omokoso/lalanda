// Registre des équipements — filtres, requête et formulaire de création ou de
// modification (ADR-0046 § 3.1, § 5.2 ; lot S9). Logique pure, testée.
//
// La requête ne porte que des IDENTIFIANTS et un statut (`ListAssetsQuery`) ; le
// formulaire produit le corps du contrat (`CreateAssetBody` / `UpdateAssetBody`),
// montants en chaînes, sans calcul. L'estimation de gestion n'a AUCUNE durée par
// défaut (décision ouverte n° 13) : champs vides → aucune estimation.

import type {
  AssetCurrency,
  AssetDetailView,
  AssetStatus,
  CreateAssetBody,
  ListAssetsParams,
  UpdateAssetBody,
} from '@/lib/api-assets';

import { estJour, lireEntierSaisi, lireMontantSaisi, montantPourSaisie } from './equipements-model';

// ── Filtres ─────────────────────────────────────────────────────────────────

export type FiltreStatut = 'active' | 'all' | AssetStatus;

export const FILTRES_STATUT: readonly { valeur: FiltreStatut; label: string }[] = [
  { valeur: 'active', label: 'Actifs' },
  { valeur: 'in_service', label: 'En service' },
  { valeur: 'in_storage', label: 'En réserve' },
  { valeur: 'under_maintenance', label: 'En maintenance' },
  { valeur: 'lost', label: 'Perdus' },
  { valeur: 'disposed', label: 'Cédés' },
  { valeur: 'all', label: 'Tous' },
];

export interface FiltresRegistre {
  statut: FiltreStatut;
  categoryId: string;
}

export function requeteRegistre(f: FiltresRegistre, cursor: string | null): ListAssetsParams {
  return {
    status: f.statut,
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(cursor ? { cursor } : {}),
    limit: 50,
  };
}

/**
 * Filtre local sur la page reçue (nom, numéro, étiquette, marque, modèle) : un tri
 * d'affichage, jamais un calcul. L'API n'offre pas de recherche texte sur le registre.
 */
export function correspond(
  a: Pick<AssetDetailView, 'name' | 'number' | 'tag' | 'brand' | 'model' | 'serialNumber'>,
  texte: string,
): boolean {
  const t = normaliser(texte);
  if (t === '') return true;
  return [a.name, a.number, a.tag, a.brand, a.model, a.serialNumber]
    .filter((v): v is string => typeof v === 'string')
    .some((v) => normaliser(v).includes(t));
}

function normaliser(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// ── Formulaire ──────────────────────────────────────────────────────────────

export interface FormulaireEquipement {
  name: string;
  categoryId: string;
  tag: string;
  brand: string;
  model: string;
  serialNumber: string;
  status: AssetStatus;
  acquisitionOn: string;
  cost: string;
  currency: AssetCurrency;
  supplierId: string;
  notes: string;
  /** Estimation de gestion : les trois vides = aucune estimation. */
  years: string;
  residualValue: string;
  startOn: string;
}

export function formulaireEquipement(
  a: AssetDetailView | null,
  aujourdhui: string,
): FormulaireEquipement {
  return {
    name: a?.name ?? '',
    categoryId: a?.categoryId ?? '',
    tag: a?.tag ?? '',
    brand: a?.brand ?? '',
    model: a?.model ?? '',
    serialNumber: a?.serialNumber ?? '',
    status: a?.status ?? 'in_service',
    acquisitionOn: a?.acquisition.on ?? aujourdhui,
    cost: montantPourSaisie(a?.acquisition.cost),
    currency: a?.acquisition.currency ?? 'USD',
    supplierId: a?.acquisition.supplierId ?? '',
    notes: a?.notes ?? '',
    years: a?.managementDepreciation ? String(a.managementDepreciation.years) : '',
    residualValue: montantPourSaisie(a?.managementDepreciation?.residualValue),
    startOn: a?.managementDepreciation?.startOn ?? '',
  };
}

export type Preparation<T> = { ok: true; corps: T } | { ok: false; champs: Record<string, string> };

const vide = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/**
 * Corps de création. Le coût est obligatoire quand il est saisi par un rôle qui
 * voit les valeurs ; `coutMasque` : le rôle ne voit pas les coûts, l'ancien coût
 * est conservé (modification) ou zéro est envoyé (création).
 */
export function preparerEquipement(
  f: FormulaireEquipement,
  options: { creation: boolean; coutMasque: boolean },
): Preparation<CreateAssetBody> {
  const champs: Record<string, string> = {};
  if (f.name.trim() === '') champs['name'] = 'Le nom est obligatoire.';
  if (f.categoryId === '') champs['categoryId'] = 'Choisissez une catégorie.';
  if (!estJour(f.acquisitionOn)) champs['acquisitionOn'] = 'Date d’acquisition obligatoire.';
  let cost = '0';
  if (!options.coutMasque) {
    const c = lireMontantSaisi(f.cost);
    if (c.ok) cost = c.valeur;
    else champs['cost'] = c.erreur;
  }

  let managementDepreciation: CreateAssetBody['managementDepreciation'] = null;
  const remplis = [f.years, f.residualValue, f.startOn].filter((v) => v.trim() !== '').length;
  if (remplis > 0) {
    const y = lireEntierSaisi(f.years, 1, 50);
    if (!y.ok) champs['years'] = `Durée : ${y.erreur}`;
    const r =
      f.residualValue.trim() === ''
        ? { ok: true as const, valeur: '0' }
        : lireMontantSaisi(f.residualValue);
    if (!r.ok) champs['residualValue'] = r.erreur;
    if (!estJour(f.startOn)) champs['startOn'] = 'Date de départ de l’estimation obligatoire.';
    if (y.ok && r.ok && estJour(f.startOn)) {
      managementDepreciation = { years: y.valeur, residualValue: r.valeur, startOn: f.startOn };
    }
  }

  if (Object.keys(champs).length > 0) return { ok: false, champs };
  const corps: CreateAssetBody = {
    name: f.name.trim(),
    categoryId: f.categoryId,
    tag: vide(f.tag),
    brand: vide(f.brand),
    model: vide(f.model),
    serialNumber: vide(f.serialNumber),
    acquisition: {
      on: f.acquisitionOn,
      cost,
      currency: f.currency,
      supplierId: f.supplierId === '' ? null : f.supplierId,
    },
    managementDepreciation,
    notes: vide(f.notes),
  };
  if (options.creation && (f.status === 'in_service' || f.status === 'in_storage')) {
    corps.status = f.status;
  }
  return { ok: true, corps };
}

/**
 * Corps de modification : mêmes champs, révision attendue ; un coût masqué n'est
 * jamais renvoyé (l'acquisition n'est pas réécrite), une estimation masquée non plus.
 */
export function preparerModification(
  f: FormulaireEquipement,
  a: AssetDetailView,
  coutMasque: boolean,
): Preparation<UpdateAssetBody> {
  const p = preparerEquipement(f, { creation: false, coutMasque });
  if (!p.ok) return p;
  const { acquisition, managementDepreciation, ...reste } = p.corps;
  // Le statut de création ne vaut pas ici : il est repris plus bas, s'il change.
  delete reste.status;
  const corps: UpdateAssetBody = { ...reste, expectedRevision: a.revision };
  if (!coutMasque) {
    corps.acquisition = acquisition;
    corps.managementDepreciation = managementDepreciation;
  }
  if (a.status !== 'disposed' && f.status !== 'disposed' && f.status !== a.status) {
    corps.status = f.status;
  }
  return { ok: true, corps };
}

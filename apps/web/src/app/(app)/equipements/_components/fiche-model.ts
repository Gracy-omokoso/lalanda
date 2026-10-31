// Fiche d'un équipement — gestes, estimation de gestion étiquetée, formulaires
// d'affectation, de retour, de maintenance, de couverture et de cession
// (ADR-0046 § 3, § 5.2, § 9 ; lot S9). Logique pure, testée.
//
// L'estimation est TOUJOURS étiquetée « Estimation de gestion — n'est pas un
// amortissement comptable ou fiscal » (O7, § 9) ; sans durée saisie, elle est
// « non estimable » avec son motif. Aucun calcul ici : la valeur estimée, la part
// consommée et le coût de possession sont ceux du moteur.

import { ASSET_MANAGEMENT_ESTIMATE_LABEL } from '@lalanda/shared/assets';

import type { OrgAction } from '@/lib/api';
import type {
  AssetAssigneeKind,
  AssetCoverageKind,
  AssetCoverageView,
  AssetCurrency,
  AssetDetailView,
  AssetDisposalKind,
  AssetMaintenanceKind,
  AssignAssetBody,
  CompleteMaintenanceBody,
  CreateCoverageBody,
  CreateMaintenanceBody,
  DisposeAssetBody,
} from '@/lib/api-assets';

import {
  estJour,
  formatJour,
  formatMontant,
  formatPourcentage,
  lireEntierSaisi,
  lireMontantSaisi,
  montantPourSaisie,
  peutGererEquipements,
} from './equipements-model';
import type { Preparation } from './registre-model';

/** Étiquette obligatoire de toute estimation (contrat partagé, § 9). */
export const ETIQUETTE_ESTIMATION = ASSET_MANAGEMENT_ESTIMATE_LABEL;

// ── Gestes ──────────────────────────────────────────────────────────────────

export type IdGeste = 'modifier' | 'affecter' | 'retourner' | 'ceder' | 'reintegrer';

export interface Geste {
  id: IdGeste;
  libelle: string;
}

/** Gestes offerts par la fiche ; aucun sans `assets.manage`. */
export function gestesEquipement(
  a: AssetDetailView,
  actions: readonly OrgAction[] | null,
): Geste[] {
  if (!peutGererEquipements(actions)) return [];
  if (a.status === 'disposed') return [{ id: 'reintegrer', libelle: 'Réintégrer' }];
  const g: Geste[] = [{ id: 'modifier', libelle: 'Modifier' }];
  g.push({ id: 'affecter', libelle: a.currentAssignment ? 'Réaffecter' : 'Affecter' });
  if (a.currentAssignment) g.push({ id: 'retourner', libelle: 'Enregistrer le retour' });
  g.push({ id: 'ceder', libelle: 'Céder ou mettre au rebut' });
  return g;
}

// ── Estimation de gestion ───────────────────────────────────────────────────

export type PhraseEstimation =
  | { etat: 'masquee'; etiquette: string; texte: string }
  | { etat: 'eteinte'; etiquette: string; texte: string }
  | { etat: 'non_estimable'; etiquette: string; texte: string }
  | {
      etat: 'estimee';
      etiquette: string;
      valeur: string;
      lignes: [string, string][];
    };

const MOTIFS: Record<string, string> = {
  NO_DURATION: 'aucune durée n’est saisie pour cet équipement',
  RESIDUAL_ABOVE_COST: 'la valeur résiduelle saisie dépasse le coût d’acquisition',
};

/** Motif lisible d'une estimation impossible ; un code inconnu reste lisible. */
export function motifNonEstimable(reason: string | null): string {
  if (reason === null) return 'paramètres incomplets';
  return MOTIFS[reason] ?? reason;
}

/**
 * Ce que montre le panneau « Amortissement indicatif ». `valeursVisibles` : le rôle
 * voit les valeurs ET la réponse ne les masque pas ; sinon l'API sert `null`.
 */
export function phraseEstimation(a: AssetDetailView, valeursVisibles: boolean): PhraseEstimation {
  const etiquette = ETIQUETTE_ESTIMATION;
  if (!valeursVisibles) {
    return {
      etat: 'masquee',
      etiquette,
      texte: 'Réservée aux rôles qui voient les prix d’achat ou la trésorerie.',
    };
  }
  const e = a.managementEstimate;
  if (e === null) {
    return {
      etat: 'eteinte',
      etiquette,
      texte: 'L’affichage de l’estimation est désactivé dans les réglages des équipements.',
    };
  }
  if (!e.estimable) {
    return {
      etat: 'non_estimable',
      etiquette,
      texte: `Non estimable : ${motifNonEstimable(e.reason)}.`,
    };
  }
  const lignes: [string, string][] = [
    ['Estimée au', formatJour(e.onDate)],
    ['Part consommée', formatPourcentage(e.consumedPercent)],
    ['Montant consommé', formatMontant(e.consumed, e.currency)],
    [
      'Durée',
      e.monthsTotal === null ? '—' : `${e.monthsElapsed ?? 0} mois écoulés sur ${e.monthsTotal}`,
    ],
    ['Fin de l’estimation', formatJour(e.endOn)],
  ];
  if (e.stoppedByDisposalOn)
    lignes.push(['Arrêtée par la cession du', formatJour(e.stoppedByDisposalOn)]);
  return {
    etat: 'estimee',
    etiquette,
    valeur: formatMontant(e.estimatedValue, e.currency),
    lignes,
  };
}

// ── Affectation et retour (§ 3.2) ───────────────────────────────────────────

export const LIBELLES_TYPE_BENEFICIAIRE: Record<AssetAssigneeKind, string> = {
  employee: 'Un collaborateur',
  member: 'Un membre de l’organisation',
  project: 'Un projet',
  location: 'Un emplacement',
};

/** Types de bénéficiaires que l'écran peut proposer : il faut pouvoir les lister. */
export function typesBeneficiaire(actions: readonly OrgAction[] | null): AssetAssigneeKind[] {
  const x = actions ?? [];
  const types: AssetAssigneeKind[] = [];
  if (x.includes('hr.read')) types.push('employee');
  types.push('member');
  if (x.includes('work.read')) types.push('project');
  if (x.includes('stock.read')) types.push('location');
  return types;
}

export interface FormulaireAffectation {
  kind: AssetAssigneeKind;
  cible: string;
  from: string;
  conditionOut: string;
  note: string;
}

export function preparerAffectation(
  f: FormulaireAffectation,
  revision: number,
): Preparation<AssignAssetBody> {
  const champs: Record<string, string> = {};
  if (f.cible === '') champs['cible'] = 'Choisissez le bénéficiaire.';
  if (!estJour(f.from)) champs['from'] = 'Date de remise obligatoire.';
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  const assignee: AssignAssetBody['assignee'] =
    f.kind === 'employee'
      ? { kind: 'employee', employeeId: f.cible }
      : f.kind === 'project'
        ? { kind: 'project', workProjectId: f.cible }
        : f.kind === 'location'
          ? { kind: 'location', locationId: f.cible }
          : { kind: 'member', userId: f.cible };
  return {
    ok: true,
    corps: {
      expectedRevision: revision,
      assignee,
      from: f.from,
      conditionOut: f.conditionOut.trim() || null,
      note: f.note.trim() || null,
    },
  };
}

// ── Maintenance (§ 3.3) ─────────────────────────────────────────────────────

export interface FormulaireMaintenance {
  kind: AssetMaintenanceKind;
  dejaFaite: boolean;
  date: string;
  cost: string;
  currency: AssetCurrency;
  performedBy: string;
  note: string;
  /** Tous les N mois (préventive seulement) ; vide = pas de récurrence. */
  everyMonths: string;
}

function coutFacultatif(
  saisie: string,
  champs: Record<string, string>,
  cle = 'cost',
): string | null {
  if (saisie.trim() === '') return null;
  const c = lireMontantSaisi(saisie);
  if (!c.ok) {
    champs[cle] = c.erreur;
    return null;
  }
  return c.valeur;
}

export function preparerMaintenance(f: FormulaireMaintenance): Preparation<CreateMaintenanceBody> {
  const champs: Record<string, string> = {};
  if (!estJour(f.date))
    champs['date'] = f.dejaFaite ? 'Date de réalisation obligatoire.' : 'Date prévue obligatoire.';
  const cost = coutFacultatif(f.cost, champs);
  let recurrence: CreateMaintenanceBody['recurrence'] = null;
  if (f.everyMonths.trim() !== '') {
    if (f.kind !== 'preventive')
      champs['everyMonths'] = 'Seule une maintenance préventive se répète.';
    else {
      const n = lireEntierSaisi(f.everyMonths, 1, 60);
      if (n.ok) recurrence = { everyMonths: n.valeur };
      else champs['everyMonths'] = n.erreur;
    }
  }
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      kind: f.kind,
      status: f.dejaFaite ? 'done' : 'planned',
      ...(f.dejaFaite ? { doneOn: f.date } : { plannedOn: f.date }),
      cost,
      currency: cost === null ? null : f.currency,
      performedBy: f.performedBy.trim() || null,
      note: f.note.trim() || null,
      recurrence,
    },
  };
}

export interface FormulaireFait {
  doneOn: string;
  cost: string;
  currency: AssetCurrency;
  performedBy: string;
  note: string;
}

export function preparerFait(
  f: FormulaireFait,
  revision: number,
): Preparation<CompleteMaintenanceBody> {
  const champs: Record<string, string> = {};
  if (!estJour(f.doneOn)) champs['doneOn'] = 'Date de réalisation obligatoire.';
  const cost = coutFacultatif(f.cost, champs);
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      expectedRevision: revision,
      doneOn: f.doneOn,
      cost,
      currency: cost === null ? null : f.currency,
      performedBy: f.performedBy.trim() || null,
      note: f.note.trim() || null,
    },
  };
}

// ── Couvertures (§ 3.4) ─────────────────────────────────────────────────────

export interface FormulaireCouverture {
  kind: AssetCoverageKind;
  provider: string;
  reference: string;
  startOn: string;
  endOn: string;
  cost: string;
  currency: AssetCurrency;
  documentId: string;
  /** Vide : réglage de l'organisation. */
  reminderDays: string;
}

export function formulaireCouverture(
  c: AssetCoverageView | null,
  aujourdhui: string,
): FormulaireCouverture {
  return {
    kind: c?.kind ?? 'warranty',
    provider: c?.provider ?? '',
    reference: c?.reference ?? '',
    startOn: c?.startOn ?? aujourdhui,
    endOn: c?.endOn ?? '',
    cost: montantPourSaisie(c?.cost),
    currency: c?.currency ?? 'USD',
    documentId: c?.documentId ?? '',
    reminderDays:
      c?.reminderDays === null || c?.reminderDays === undefined ? '' : String(c.reminderDays),
  };
}

export function preparerCouverture(
  f: FormulaireCouverture,
  coutMasque: boolean,
): Preparation<CreateCoverageBody> {
  const champs: Record<string, string> = {};
  if (f.provider.trim() === '') champs['provider'] = 'Le prestataire est obligatoire.';
  if (!estJour(f.startOn)) champs['startOn'] = 'Date de début obligatoire.';
  if (!estJour(f.endOn)) champs['endOn'] = 'Date de fin obligatoire.';
  else if (estJour(f.startOn) && f.endOn < f.startOn) champs['endOn'] = 'La fin précède le début.';
  const cost = coutMasque ? null : coutFacultatif(f.cost, champs);
  let reminderDays: number | null = null;
  if (f.reminderDays.trim() !== '') {
    const r = lireEntierSaisi(f.reminderDays, 0, 120);
    if (r.ok) reminderDays = r.valeur;
    else champs['reminderDays'] = r.erreur;
  }
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  const corps: CreateCoverageBody = {
    kind: f.kind,
    provider: f.provider.trim(),
    reference: f.reference.trim() || null,
    startOn: f.startOn,
    endOn: f.endOn,
    documentId: f.documentId === '' ? null : f.documentId,
    reminderDays,
  };
  if (!coutMasque) {
    corps.cost = cost;
    corps.currency = cost === null ? null : f.currency;
  }
  return { ok: true, corps };
}

// ── Cession (§ 3.1) ─────────────────────────────────────────────────────────

export interface FormulaireCession {
  kind: AssetDisposalKind;
  on: string;
  proceeds: string;
  currency: AssetCurrency;
  buyer: string;
  reason: string;
}

/** Une cession DÉCLARÉE : aucune facture, aucun encaissement (décision n° 15). */
export function preparerCession(
  f: FormulaireCession,
  revision: number,
): Preparation<DisposeAssetBody> {
  const champs: Record<string, string> = {};
  if (!estJour(f.on)) champs['on'] = 'Date obligatoire.';
  if (f.reason.trim() === '') champs['reason'] = 'Le motif est obligatoire.';
  const proceeds = f.kind === 'sold' ? coutFacultatif(f.proceeds, champs, 'proceeds') : null;
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      expectedRevision: revision,
      on: f.on,
      kind: f.kind,
      proceeds,
      currency: proceeds === null ? null : f.currency,
      buyer: f.kind === 'sold' ? f.buyer.trim() || null : null,
      reason: f.reason.trim(),
    },
  };
}

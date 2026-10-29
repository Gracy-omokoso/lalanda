// Logique pure du pipeline v2 — ADR-0040 § 6 (Kanban par glisser-déposer
// accessible au clavier, responsable, motifs de perte, prévision pondérée).
//
// Isolée du rendu pour être testée sans DOM. Mêmes règles que `crm-model.ts` :
// AUCUN CALCUL DE MONTANT (prévision, totaux et probabilités viennent de l'API,
// moteur `crm`) ; RIEN N'AUTORISE (masquer un bouton est un confort).

import type {
  CrmSettingsView,
  LostReason,
  OpportunitySummary,
  PipelineStage,
  WeightedForecast,
} from '@/lib/api-crm';

import { formatMontant } from '../../ventes/_components/sales-model';

import type { MembreCrm } from './crm-access';

// ── Responsable ─────────────────────────────────────────────────────────────

/** Nom d'un membre ; « Un membre » si son nom n'est pas lisible par ce rôle. */
export function nomMembre(membres: readonly MembreCrm[], userId: string | null): string {
  if (userId === null) return 'Personne';
  return membres.find((m) => m.userId === userId)?.name ?? 'Un membre';
}

/** Libellé du responsable d'une opportunité, orpheline comprise (§ 2.3). */
export function libelleResponsable(
  o: Pick<OpportunitySummary, 'ownerId' | 'orphaned'>,
  membres: readonly MembreCrm[],
): string {
  if (o.orphaned) return 'Sans responsable (à réassigner)';
  return `Responsable : ${nomMembre(membres, o.ownerId)}`;
}

/** Filtre responsable du pipeline : `me` (les miennes) ou tout le pipeline. */
export type FiltreResponsable = 'tous' | 'miennes';

export function requetePipeline(f: FiltreResponsable): { ownerId?: string } {
  return f === 'miennes' ? { ownerId: 'me' } : {};
}

/**
 * Filtre par défaut (§ 6.1) : « Les miennes » pour un rôle qui n'invite pas de
 * membres — confort d'affichage, pas un contrôle d'accès.
 */
export function filtreResponsableParDefaut(actions: readonly string[] | null): FiltreResponsable {
  return actions !== null && !actions.includes('members.invite') ? 'miennes' : 'tous';
}

// ── Motifs de perte ─────────────────────────────────────────────────────────

/** Motifs proposés à la saisie : les actifs seulement. */
export function motifsActifs(reasons: readonly LostReason[]): LostReason[] {
  return reasons.filter((r) => r.active);
}

/** Libellé d'un motif par sa clé ; une clé inconnue s'affiche telle quelle. */
export function libelleMotif(reasons: readonly LostReason[], key: string | null): string | null {
  if (key === null) return null;
  return reasons.find((r) => r.key === key)?.label ?? key;
}

export interface SaisieMotif {
  key: string;
  detail: string;
}

/** Corps du motif de perte ; refusé si obligatoire et absent (`CRM_LOST_REASON_REQUIRED`). */
export function preparerMotif(
  s: SaisieMotif,
  settings: Pick<CrmSettingsView, 'lostReasonRequired'>,
):
  | { ok: true; corps: { lostReasonKey: string | null; lostReasonDetail: string | null } }
  | { ok: false; erreur: string } {
  if (s.key === '' && settings.lostReasonRequired) {
    return { ok: false, erreur: 'Choisissez le motif de la perte : il est obligatoire.' };
  }
  const detail = s.detail.trim();
  if (detail.length > 500) return { ok: false, erreur: 'Détail : 500 caractères au plus.' };
  return {
    ok: true,
    corps: { lostReasonKey: s.key === '' ? null : s.key, lostReasonDetail: detail || null },
  };
}

// ── Glisser-déposer au clavier (§ 6.2) ──────────────────────────────────────

/**
 * Saisie d'une carte au clavier : `Espace` saisit, `←` / `→` changent de
 * colonne, `Entrée` dépose, `Échap` annule. L'état ne garde que la carte et la
 * colonne visée ; le dépôt est un `POST …/move` (aucun rang manuel).
 */
export interface Saisie {
  opportunityId: string;
  /** Étape de départ. */
  origine: string;
  /** Étape visée. */
  cible: string;
}

export type ToucheKanban = ' ' | 'ArrowLeft' | 'ArrowRight' | 'Enter' | 'Escape';

export type ResultatClavier =
  | { type: 'rien' }
  | { type: 'saisie'; saisie: Saisie; annonce: string }
  | { type: 'deplace'; saisie: Saisie; annonce: string }
  | { type: 'depot'; saisie: Saisie }
  | { type: 'annule'; annonce: string };

function etapeLabel(stages: readonly PipelineStage[], key: string): string {
  return stages.find((s) => s.key === key)?.label ?? key;
}

export function toucheKanban(
  stages: readonly PipelineStage[],
  o: Pick<OpportunitySummary, 'id' | 'title' | 'stageKey'>,
  saisie: Saisie | null,
  touche: string,
): ResultatClavier {
  const enCours = saisie !== null && saisie.opportunityId === o.id ? saisie : null;
  if (enCours === null) {
    if (touche !== ' ') return { type: 'rien' };
    const s = { opportunityId: o.id, origine: o.stageKey, cible: o.stageKey };
    return {
      type: 'saisie',
      saisie: s,
      annonce: `« ${o.title} » saisie dans ${etapeLabel(stages, o.stageKey)}. Flèches gauche et droite pour changer d’étape, Entrée pour déposer, Échap pour annuler.`,
    };
  }
  if (touche === 'Escape') {
    return { type: 'annule', annonce: `Déplacement de « ${o.title} » annulé.` };
  }
  if (touche === 'Enter' || touche === ' ') {
    return enCours.cible === enCours.origine
      ? { type: 'annule', annonce: `« ${o.title} » reste en ${etapeLabel(stages, o.stageKey)}.` }
      : { type: 'depot', saisie: enCours };
  }
  if (touche === 'ArrowLeft' || touche === 'ArrowRight') {
    const i = stages.findIndex((s) => s.key === enCours.cible);
    const j = touche === 'ArrowLeft' ? i - 1 : i + 1;
    const suivante = stages[j];
    if (i === -1 || !suivante) return { type: 'rien' };
    return {
      type: 'deplace',
      saisie: { ...enCours, cible: suivante.key },
      annonce: `Au-dessus de ${suivante.label}.`,
    };
  }
  return { type: 'rien' };
}

/** Annonce `aria-live` après un dépôt réussi. */
export function annonceDepot(titre: string, stages: readonly PipelineStage[], key: string): string {
  return `Opportunité ${titre} déplacée en ${etapeLabel(stages, key)}.`;
}

/** Ce qu'il faut demander avant de déposer : le motif (perdu), rien sinon. */
export function suiteDepot(
  stages: readonly PipelineStage[],
  cible: string,
): 'motif' | 'gagne' | 'direct' {
  const kind = stages.find((s) => s.key === cible)?.kind;
  return kind === 'lost' ? 'motif' : kind === 'won' ? 'gagne' : 'direct';
}

/** Une carte se déplace-t-elle ? Ouverte, et le rôle gère le CRM. */
export function deplacable(o: Pick<OpportunitySummary, 'status'>, gerer: boolean): boolean {
  return gerer && o.status === 'open';
}

// ── Prévision pondérée (§ 7.1, recopiée du moteur) ──────────────────────────

export interface LignePrevision {
  currency: string;
  pondere: string;
  brut: string;
  detail: string;
  nonPonderable: string | null;
}

/** Une ligne par devise, chiffres de l'API seulement ; jamais de somme entre devises. */
export function lignesPrevision(f: WeightedForecast): LignePrevision[] {
  return f.currencies.map((c) => ({
    currency: c.currency,
    pondere: formatMontant(c.weighted, c.currency),
    brut: formatMontant(c.unweighted, c.currency),
    detail: `${c.count} opportunité${c.count > 1 ? 's' : ''} ouverte${c.count > 1 ? 's' : ''}`,
    nonPonderable:
      c.notWeightable.count === 0
        ? null
        : `Non pondérable : ${formatMontant(c.notWeightable.total, c.currency)} (${c.notWeightable.count} opportunité${c.notWeightable.count > 1 ? 's' : ''} sans probabilité ou sans montant)`,
  }));
}

export const MENTION_ESTIME =
  'Montants estimés — calculés par Lalanda à partir des opportunités ; ni réalisé, ni plan.';

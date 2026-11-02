// Logique pure du module « Fonctionnalités par offre » de la console (ADR-0053 § 6.3 —
// lot P4). Testée sans DOM. Elle n'autorise rien : l'API juge chaque dérogation
// (motif, échéance de 90 jours au plus, ré-authentification, conflit d'intérêts).

import { PLATFORM_LIMITS } from '@lalanda/shared/platform';
import { FEATURES, isFeatureKey, type FeatureKey } from '@lalanda/shared/pricing';

import type { AdminFeaturesView } from '@/lib/api';

import { MOTIF_VIDE, motifComplet, type MotifSaisi } from './motif-model';

const JOUR_MS = 86_400_000;

/** Échéance maximale d'une dérogation (décision ouverte n° 10). */
export const ECHEANCE_MAX_JOURS = PLATFORM_LIMITS.featureOverrideMaxDays;

/** Échéance proposée par défaut : 30 jours, la plus courte qui couvre un mois. */
export const ECHEANCE_DEFAUT_JOURS = 30;

export interface DerogationSaisie {
  targetOrganizationId: string;
  feature: FeatureKey | '';
  /** Date `AAAA-MM-JJ` saisie dans le champ ; l'échéance tombe à 23:59 UTC ce jour-là. */
  echeance: string;
  motif: MotifSaisi;
}

export function derogationVide(maintenant: Date): DerogationSaisie {
  return {
    targetOrganizationId: '',
    feature: '',
    echeance: dateDuJour(new Date(maintenant.getTime() + ECHEANCE_DEFAUT_JOURS * JOUR_MS)),
    motif: MOTIF_VIDE,
  };
}

/** `AAAA-MM-JJ` (UTC) d'un instant. */
export function dateDuJour(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Échéance ISO envoyée à l'API, ou `null` si la date est illisible. */
export function echeanceIso(echeance: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(echeance)) return null;
  const t = Date.parse(`${echeance}T23:59:00.000Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** L'échéance tombe-t-elle dans l'avenir et dans les 90 jours ? */
export function echeanceValide(echeance: string, maintenant: Date): boolean {
  const iso = echeanceIso(echeance);
  if (iso === null) return false;
  const delta = Date.parse(iso) - maintenant.getTime();
  return delta > 0 && delta <= ECHEANCE_MAX_JOURS * JOUR_MS;
}

/** Identifiant d'organisation : 24 hexadécimaux (`PLATFORM_ID_INVALID` sinon). */
export function identifiantValide(id: string): boolean {
  return /^[0-9a-f]{24}$/i.test(id.trim());
}

/** Le formulaire de dérogation est-il complet ? (catégorie et note interne exigées) */
export function derogationComplete(saisie: DerogationSaisie, maintenant: Date): boolean {
  return (
    identifiantValide(saisie.targetOrganizationId) &&
    isFeatureKey(saisie.feature) &&
    echeanceValide(saisie.echeance, maintenant) &&
    motifComplet(saisie.motif, { avecCategorie: true, avecMessageClient: false })
  );
}

/** Libellé d'une fonctionnalité du catalogue (la clé brute si inconnue). */
export function libelleFonctionnalite(cle: string): string {
  return isFeatureKey(cle) ? FEATURES[cle].label : cle;
}

/** Phrase de tête de la grille. */
export function resumeGrille(vue: Pick<AdminFeaturesView, 'closedCells'>): string {
  return vue.closedCells === 0
    ? 'Grille entièrement ouverte : chaque offre permet chaque fonctionnalité. La répartition reste à arbitrer (docs/13) ; elle se change en code, revue et testée, jamais depuis la console.'
    : `${vue.closedCells} case(s) fermée(s) dans la grille. Une organisation concernée peut recevoir une dérogation motivée et datée.`;
}

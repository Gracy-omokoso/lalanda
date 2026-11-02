// Module « Abonnements et paiements » de la console (ADR-0053 § 6.2 — lot P3).
// Fonctions pures, testées. L'API juge de tout (seconde personne, conflit d'intérêts,
// ré-authentification) : ces fonctions EXPLIQUENT avant le geste, elles n'autorisent rien.
//
// Vocabulaire (§ 6.8, décision n° 14) : « montant dû », « encaissement » ; jamais un mot
// réservé aux pièces fiscales, tant qu'ADR-0047 n'est pas tranché.

import { PLATFORM_LIMITS } from '@lalanda/shared/platform';

import type {
  AdminManualPaymentStatus,
  AdminPlanGrantPhase,
  AdminSubscriptionStatus,
  Plan,
} from '@/lib/api';

import { codeErreur, messageErreur, type TonStatut } from './admin-model';

const JOUR_MS = 86_400_000;

export const STATUTS_ABONNEMENT: ReadonlyArray<{
  valeur: AdminSubscriptionStatus;
  libelle: string;
}> = [
  { valeur: 'trialing', libelle: 'Essai' },
  { valeur: 'active', libelle: 'Actif' },
  { valeur: 'past_due', libelle: 'Paiement en échec' },
  { valeur: 'grace', libelle: 'Période de grâce' },
  { valeur: 'suspended', libelle: 'Suspendu (impayé)' },
  { valeur: 'canceled', libelle: 'Résilié' },
];

export function libelleStatutAbonnement(statut: string): string {
  return STATUTS_ABONNEMENT.find((s) => s.valeur === statut)?.libelle ?? statut;
}

/**
 * Ton d'un état d'abonnement. `suspended` est l'état d'IMPAYÉ (offre gratuite), à ne pas
 * confondre avec la suspension administrative d'une organisation (O4) : libellé distinct.
 */
export function tonStatutAbonnement(statut: string): TonStatut {
  if (statut === 'active' || statut === 'trialing') return 'succes';
  if (statut === 'past_due' || statut === 'grace') return 'attention';
  if (statut === 'suspended') return 'echec';
  return 'neutre';
}

export const STATUTS_PAIEMENT: ReadonlyArray<{
  valeur: AdminManualPaymentStatus;
  libelle: string;
}> = [
  { valeur: 'pending', libelle: 'En attente' },
  { valeur: 'confirmed', libelle: 'Confirmé' },
  { valeur: 'rejected', libelle: 'Refusé' },
  { valeur: 'expired', libelle: 'Expiré' },
];

export function libelleStatutPaiement(statut: string): string {
  return STATUTS_PAIEMENT.find((s) => s.valeur === statut)?.libelle ?? statut;
}

export function tonStatutPaiement(statut: string): TonStatut {
  if (statut === 'confirmed') return 'succes';
  if (statut === 'pending') return 'attention';
  if (statut === 'rejected') return 'echec';
  return 'neutre';
}

const MOYENS: Record<string, string> = {
  mobile_money: 'Mobile money',
  bank_transfer: 'Virement',
  manual: 'Dépôt manuel',
  stripe: 'Carte (Stripe)',
  paypal: 'PayPal',
};

export function libelleMoyen(moyen: string | null): string {
  if (!moyen) return '—';
  return MOYENS[moyen] ?? moyen;
}

const PHASES: Record<AdminPlanGrantPhase, { libelle: string; ton: TonStatut }> = {
  pending_approval: { libelle: 'En attente d’une seconde personne', ton: 'attention' },
  scheduled: { libelle: 'Programmé', ton: 'neutre' },
  active: { libelle: 'En vigueur', ton: 'succes' },
  expired: { libelle: 'Échu', ton: 'neutre' },
  revoked: { libelle: 'Retiré', ton: 'neutre' },
};

export function phaseOctroi(phase: AdminPlanGrantPhase): { libelle: string; ton: TonStatut } {
  return PHASES[phase];
}

/** Montant dû, en unités de la devise de facturation, sans conversion (docs/13 § 5). */
export function formaterMontant(centimes: number, devise: string): string {
  const valeur = (centimes / 100).toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${valeur} ${devise}`;
}

/**
 * L'octroi demandera-t-il une seconde personne (§ 5.3) ? Offre Expert, sans échéance, ou
 * plus de 90 jours. Sert à PRÉVENIR l'opérateur ; l'API décide (et tolère le seul
 * détenteur, marqué).
 */
export function octroiDemandeSecondePersonne(
  plan: Plan,
  echeance: string | null,
  maintenant: Date,
): boolean {
  if (plan === 'expert') return true;
  if (!echeance) return true;
  const fin = Date.parse(echeance);
  if (Number.isNaN(fin)) return true;
  return (fin - maintenant.getTime()) / JOUR_MS > PLATFORM_LIMITS.grantSecondPersonDays;
}

/** Une échéance saisie au format `AAAA-MM-JJ` → fin de journée UTC, ou `null`. */
export function echeanceDepuisSaisie(saisie: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saisie)) return null;
  const date = new Date(`${saisie}T23:59:59.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Un identifiant d'organisation saisi est-il un identifiant Mongo (24 hexadécimaux) ? */
export function identifiantOrganisationValide(id: string): boolean {
  return /^[0-9a-f]{24}$/i.test(id.trim());
}

/** Offres qu'un octroi peut accorder : `free` n'en est pas une (retirer l'octroi). */
export function offresOctroyables(plans: readonly Plan[]): Plan[] {
  return plans.filter((p) => p !== 'free');
}

const MESSAGES: Record<string, string> = {
  PLATFORM_SELF_DEALING:
    'Vous êtes membre de cette organisation : un autre opérateur doit accomplir ce geste.',
  SELF_APPROVAL_FORBIDDEN: 'Vous avez préparé cet octroi : une seconde personne doit l’approuver.',
  GRANT_ALREADY_OPEN:
    'Un octroi est déjà en cours ou en attente pour cette organisation : retirez-le d’abord.',
  GRANT_PLAN_INVALID: 'Un octroi accorde une offre payante ; pour revenir au gratuit, retirez-le.',
  GRANT_PERIOD_INVALID: 'Échéance invalide : elle doit être future.',
  GRANT_NOT_PENDING: 'Cet octroi n’attend plus d’approbation.',
  GRANT_ALREADY_REVOKED: 'Cet octroi est déjà retiré.',
  MANUAL_REQUEST_CLOSED: 'Cette demande est déjà traitée.',
  MANUAL_REQUEST_EXPIRED: 'Cette demande a expiré : le client doit en ouvrir une nouvelle.',
  MANUAL_REQUEST_NOT_FOUND: 'Référence de paiement inconnue.',
  REASON_REQUIRED: 'Motif incomplet : la note interne compte dix caractères au moins.',
  REAUTH_REQUIRED: 'Votre fenêtre de modification s’est refermée : confirmez votre mot de passe.',
};

export function messageErreurAbonnements(err: unknown, repli: string): string {
  const code = codeErreur(err);
  return code && MESSAGES[code] ? MESSAGES[code] : messageErreur(err, repli);
}

/** Libellé du résultat d'un octroi préparé : actif tout de suite ou en attente. */
export function resultatOctroi(phase: AdminPlanGrantPhase, seulDetenteur: boolean): string {
  if (phase === 'pending_approval') {
    return 'Octroi préparé : il attend l’approbation d’une seconde personne.';
  }
  return seulDetenteur
    ? 'Octroi en vigueur, accordé par le seul détenteur du droit (marqué au journal).'
    : 'Octroi en vigueur. Il paraît au journal du client sous « Équipe Lalanda ».';
}

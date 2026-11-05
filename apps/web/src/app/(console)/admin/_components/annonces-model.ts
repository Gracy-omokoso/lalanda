// Module « Annonces » de la console (ADR-0053 § 6.6 — lot P6). Fonctions pures, testées.
// L'API juge de tout (seconde personne, nombre retapé, ré-authentification) : ces
// fonctions EXPLIQUENT avant le geste, elles n'autorisent rien.

import { PLANS } from '@lalanda/shared/pricing';
import {
  PLATFORM_AUDIENCE_SUBSCRIPTION_STATUSES,
  PLATFORM_LIMITS,
  type AudienceFilter,
} from '@lalanda/shared/platform';

import type { AdminAnnouncementStatus } from '@/lib/announcements-api';
import { ORG_ROLES, type OrgRole, type Plan } from '@/lib/api';

import { codeErreur, LIBELLES_PLAN, messageErreur, type TonStatut } from './admin-model';

const JOUR_MS = 86_400_000;

const STATUTS: Record<AdminAnnouncementStatus, { libelle: string; ton: TonStatut }> = {
  draft: { libelle: 'Brouillon', ton: 'neutre' },
  pending_approval: { libelle: 'En attente d’approbation', ton: 'attention' },
  approved: { libelle: 'Approuvée, à envoyer', ton: 'attention' },
  sent: { libelle: 'Envoyée', ton: 'succes' },
  canceled: { libelle: 'Annulée', ton: 'neutre' },
  withdrawn: { libelle: 'Retirée', ton: 'neutre' },
};

/** ADR-0054 : seule une annonce ENVOYÉE se retire ; avant l'envoi, elle s'annule. */
export function gesteDeFin(statut: AdminAnnouncementStatus): 'annuler' | 'retirer' | null {
  if (statut === 'sent') return 'retirer';
  if (statut === 'canceled' || statut === 'withdrawn') return null;
  return 'annuler';
}

export function statutAnnonce(statut: AdminAnnouncementStatus): {
  libelle: string;
  ton: TonStatut;
} {
  return STATUTS[statut];
}

/** Libellés de présentation des rôles d'organisation (la matrice reste dans l'API). */
export const LIBELLES_ROLES_ORG: Record<OrgRole, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  finance_director: 'Directeur financier',
  accountant: 'Comptable',
  analyst: 'Analyste',
  project_manager: 'Chef de projet',
  advisor: 'Conseiller',
  viewer: 'Lecteur',
  sales_rep: 'Commercial',
  hr_manager: 'Responsable RH',
  storekeeper: 'Magasinier',
  external_accountant: 'Expert-comptable externe',
  // ADR-0059 § 2.
  employee: 'Salarié',
  team_manager: 'Manager / Chef d’équipe',
  intern: 'Stagiaire',
  guest: 'Invité externe',
};

export const LIBELLES_ETATS_ABONNEMENT: Record<
  (typeof PLATFORM_AUDIENCE_SUBSCRIPTION_STATUSES)[number],
  string
> = {
  trialing: 'Essai',
  active: 'Actif',
  past_due: 'Paiement en échec',
  grace: 'Période de grâce',
  suspended: 'Suspendu (impayé)',
  canceled: 'Résilié ou sans abonnement',
};

export const ETATS_ABONNEMENT = PLATFORM_AUDIENCE_SUBSCRIPTION_STATUSES;
export const OFFRES: readonly Plan[] = PLANS;
export const ROLES_ORG: readonly OrgRole[] = ORG_ROLES;

/** Saisie du formulaire de catégorie (cases cochées, champs texte). */
export interface SaisieAudience {
  proprietairesSeulement: boolean;
  offres: Plan[];
  etats: string[];
  /** Codes pays séparés par des virgules ou des espaces (« CD, CG »). */
  pays: string;
  roles: OrgRole[];
  /** `AAAA-MM-JJ` ou vide. */
  inscritsApres: string;
  inscritsAvant: string;
}

export const SAISIE_AUDIENCE_VIDE: SaisieAudience = {
  proprietairesSeulement: false,
  offres: [],
  etats: [],
  pays: '',
  roles: [],
  inscritsApres: '',
  inscritsAvant: '',
};

/** Codes pays saisis, en majuscules, sans doublon ; `null` si l'un est invalide. */
export function paysSaisis(texte: string): string[] | null {
  const codes = texte
    .split(/[\s,;]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  if (codes.some((c) => !/^[A-Z]{2}$/.test(c))) return null;
  return [...new Set(codes)];
}

function jourIso(jour: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return undefined;
  return new Date(`${jour}T00:00:00.000Z`).toISOString();
}

/** Saisie → catégorie de l'API (`AudienceFilter`). Un critère vide est omis. */
export function audienceDepuisSaisie(s: SaisieAudience): AudienceFilter {
  const filtre: AudienceFilter = {};
  if (s.proprietairesSeulement) filtre.ownersOnly = true;
  if (s.offres.length > 0) filtre.plans = [...s.offres];
  if (s.etats.length > 0) {
    filtre.subscriptionStatuses = s.etats as NonNullable<AudienceFilter['subscriptionStatuses']>;
  }
  const pays = paysSaisis(s.pays);
  if (pays && pays.length > 0) filtre.countries = pays;
  if (s.roles.length > 0) filtre.orgRoles = [...s.roles];
  const apres = jourIso(s.inscritsApres);
  const avant = jourIso(s.inscritsAvant);
  if (apres) filtre.signedUpAfter = apres;
  if (avant) filtre.signedUpBefore = avant;
  return filtre;
}

/** Catégorie → saisie (pour reprendre un brouillon). */
export function saisieDepuisAudience(f: AudienceFilter): SaisieAudience {
  return {
    proprietairesSeulement: f.ownersOnly === true,
    offres: [...(f.plans ?? [])] as Plan[],
    etats: [...(f.subscriptionStatuses ?? [])],
    pays: (f.countries ?? []).join(', '),
    roles: [...(f.orgRoles ?? [])] as OrgRole[],
    inscritsApres: f.signedUpAfter?.slice(0, 10) ?? '',
    inscritsAvant: f.signedUpBefore?.slice(0, 10) ?? '',
  };
}

/** Résumé lisible de la catégorie (« Propriétaires · offre Pro · pays CD »). */
export function resumeAudience(f: AudienceFilter): string {
  const parties: string[] = [];
  parties.push(f.ownersOnly ? 'Propriétaires' : 'Tous les comptes actifs');
  if (f.orgRoles?.length) {
    parties.push(
      `rôle ${f.orgRoles.map((r) => LIBELLES_ROLES_ORG[r as OrgRole] ?? r).join(' ou ')}`,
    );
  }
  if (f.plans?.length) {
    parties.push(`offre ${f.plans.map((p) => LIBELLES_PLAN[p as Plan] ?? p).join(' ou ')}`);
  }
  if (f.subscriptionStatuses?.length) {
    parties.push(
      `abonnement ${f.subscriptionStatuses
        .map((e) => LIBELLES_ETATS_ABONNEMENT[e] ?? e)
        .join(' ou ')}`,
    );
  }
  if (f.countries?.length) parties.push(`pays ${f.countries.join(', ')}`);
  if (f.signedUpAfter) parties.push(`inscrits depuis le ${f.signedUpAfter.slice(0, 10)}`);
  if (f.signedUpBefore) parties.push(`inscrits avant le ${f.signedUpBefore.slice(0, 10)}`);
  return parties.join(' · ');
}

/** Problèmes de saisie à corriger avant l'envoi au serveur (le serveur revérifie). */
export function erreursBrouillon(input: {
  titre: string;
  texte: string;
  saisie: SaisieAudience;
  fin: string;
  maintenant?: Date;
}): string[] {
  const erreurs: string[] = [];
  if (input.titre.trim() === '') erreurs.push('Titre obligatoire.');
  if (input.titre.trim().length > PLATFORM_LIMITS.announcementTitleMaxLength) {
    erreurs.push(`Titre : ${PLATFORM_LIMITS.announcementTitleMaxLength} caractères au plus.`);
  }
  if (input.texte.trim() === '') erreurs.push('Texte obligatoire.');
  if (input.texte.trim().length > PLATFORM_LIMITS.announcementBodyMaxLength) {
    erreurs.push(`Texte : ${PLATFORM_LIMITS.announcementBodyMaxLength} caractères au plus.`);
  }
  if (paysSaisis(input.saisie.pays) === null) {
    erreurs.push('Pays : codes ISO à deux lettres (CD, CG, FR…).');
  }
  if (input.fin !== '') {
    const fin = jourIso(input.fin);
    if (!fin || new Date(fin) <= (input.maintenant ?? new Date())) {
      erreurs.push('La date de fin doit être dans le futur.');
    }
  }
  return erreurs;
}

/** Date de fin saisie → ISO (fin de journée UTC) ; vide → défaut serveur (30 jours). */
export function finDepuisSaisie(jour: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return undefined;
  return new Date(`${jour}T23:59:59.000Z`).toISOString();
}

/** Fin par défaut affichée : envoi + 30 jours. */
export function finParDefaut(maintenant: Date = new Date()): Date {
  return new Date(maintenant.getTime() + PLATFORM_LIMITS.announcementDefaultExpiryDays * JOUR_MS);
}

/** L'envoi n'est proposé que si le nombre retapé égale le nombre approuvé. */
export function nombreRetapeValide(saisi: string, approuve: number | null): boolean {
  if (approuve === null || !/^\d+$/.test(saisi.trim())) return false;
  return Number.parseInt(saisi.trim(), 10) === approuve;
}

const MESSAGES: Record<string, string> = {
  SELF_APPROVAL_FORBIDDEN:
    'Vous avez préparé ou soumis cette annonce : une autre personne doit l’approuver.',
  AUDIENCE_COUNT_MISMATCH: 'Le nombre retapé ne correspond pas au nombre approuvé.',
  REAPPROVAL_REQUIRED:
    'Le nombre de destinataires a changé de plus de 10 % : l’annonce repart en approbation.',
  PREVIEW_REQUIRED: 'Affichez l’aperçu avant de soumettre.',
  ANNOUNCEMENT_ALL_ACTIVE: 'Une annonce à tous les comptes est déjà en cours.',
  ANNOUNCEMENT_EXPIRED: 'La date de fin est passée.',
  ANNOUNCEMENT_NOT_AUTHOR: 'Seul l’auteur modifie son brouillon.',
  ANNOUNCEMENT_WRONG_STATUS: 'L’annonce a changé d’état : rechargez la liste.',
  AUDIENCE_INVALID: 'Catégorie de destinataires invalide.',
};

export function messageErreurAnnonces(err: unknown, repli: string): string {
  const code = codeErreur(err);
  return code && MESSAGES[code] ? MESSAGES[code] : messageErreur(err, repli);
}

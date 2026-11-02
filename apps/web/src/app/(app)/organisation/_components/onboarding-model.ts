// Logique pure de la mise en route d'une société (ADR-0052 § 2 et § 3, étend ADR-0030 § 8).
// ADR-0052 — O2.
//
// L'avancement vient de l'API (`GET /organizations/current/setup`) : ce module ne lit rien
// et ne recalcule aucun verrou. Il met en mots ce que le serveur dit — étapes, capacités
// (facturer, normaliser, tenir les livres) et ce qui leur manque — et décide où reprendre.
//
// Libellés : « obligatoire » n'est employé pour AUCUN champ (ADR-0052 F3, ADR-0021 § 2) ; ce
// que le serveur exige est dit par l'acte qu'il bloque (« sans cette fiche, aucune facture »).

import {
  ORGANIZATION_SETUP_STEP_IDS,
  isDeferrableStep,
  type OrganizationSetupCapability,
  type OrganizationSetupStep,
  type OrganizationSetupStepId,
  type OrganizationSetupView,
} from '@lalanda/shared/organization-setup';
import type { StepState } from '@lalanda/ui';

import { LIBELLES_CONDITION } from '../../comptabilite/_components/activation-model';

import { libellePrerequis } from './fiscal-model';

export type EtapeId = OrganizationSetupStepId;

export interface Etape {
  id: EtapeId;
  label: string;
  /** Pourquoi cette étape, en une phrase, du côté de l'utilisateur. */
  pourquoi: string;
  /** Qui peut la faire, pour l'expliquer à un rôle qui ne le peut pas. */
  quiPeut: string;
  /** Libellé du report (« pas maintenant ») quand l'ADR l'offre (§ 4), sinon `null`. */
  report: string | null;
}

const GERANT = 'un Propriétaire ou un Administrateur';
const FISCAL = 'un Propriétaire ou un Directeur financier';

export const ETAPES: readonly Etape[] = [
  {
    id: 'societe',
    label: 'Société',
    pourquoi:
      'Le nom et le pays de votre société. Une organisation est une entreprise distincte : elle a ses propres clients, comptes et membres. Vérifiez puis confirmez le pays.',
    quiPeut: GERANT,
    report: null,
  },
  {
    id: 'fiscal',
    label: 'Identité légale et fiscale',
    pourquoi:
      'Les informations qui figurent sur vos factures : dénomination, NIF, siège. Sans cette fiche, aucune facture ne peut être émise. Le RCCM, la forme juridique et l’identification nationale sont facultatifs — à confirmer avec votre juriste s’ils doivent figurer sur vos factures.',
    quiPeut: FISCAL,
    report: null,
  },
  {
    id: 'devises',
    label: 'Devises',
    pourquoi:
      'La devise d’affichage par défaut des projets de la société. La monnaie de tenue des comptes se choisit à l’étape Comptabilité. Votre devise personnelle (Mon compte) ne change que votre propre affichage.',
    quiPeut: GERANT,
    report: null,
  },
  {
    id: 'identite',
    label: 'Identité visuelle',
    pourquoi:
      'Votre logo, vos couleurs, votre police et votre modèle de facture habillent vos documents. Recommandé, jamais exigé.',
    quiPeut: GERANT,
    report: null,
  },
  {
    id: 'normalisation',
    label: 'Facture normalisée DGI',
    pourquoi:
      'Facultatif : c’est un choix de votre entreprise. Les points de vente e-MCF reçoivent vos factures normalisées par la DGI ; vous pouvez commencer en mode test. Sans elle, vos factures ordinaires restent possibles.',
    quiPeut: FISCAL,
    report: 'Pas maintenant',
  },
  {
    id: 'tresorerie',
    label: 'Trésorerie',
    pourquoi:
      'Vos comptes bancaires, caisses et mobile money, avec leur devise et leur solde d’ouverture. Recommandé, pour suivre ce que vous encaissez et dépensez.',
    quiPeut: 'une personne autorisée à gérer la trésorerie',
    report: 'Pas maintenant',
  },
  {
    id: 'comptabilite',
    label: 'Comptabilité et exercice',
    pourquoi:
      'Facultatif. La comptabilité est désactivée par défaut ; la simulation est toujours permise. Le passage en mode actif demande un plan relu, une monnaie de tenue, une date de bascule et un exercice ouvert. Le mois de début d’exercice est à confirmer avec votre expert-comptable.',
    quiPeut: 'une personne autorisée à gérer la comptabilité',
    report: 'Pas maintenant',
  },
  {
    id: 'equipe',
    label: 'Équipe',
    pourquoi:
      'Invitez vos collaborateurs et choisissez leur rôle. Facultatif : vous pouvez travailler seul.',
    quiPeut: GERANT,
    report: 'Je travaille seul',
  },
  {
    id: 'modules',
    label: 'Modules, réglages et offre',
    pourquoi:
      'Les modules que la société utilise, en tête de l’accueil de chaque membre, les réglages de chaque module et votre offre. Rien n’est verrouillé par ce choix.',
    quiPeut: GERANT,
    report: null,
  },
];

export function etapeDe(id: EtapeId): Etape {
  return ETAPES.find((e) => e.id === id)!;
}

/** Étape de la vue ; la vue porte toujours les neuf (contrat zod). */
export function etapeVue(vue: OrganizationSetupView, id: EtapeId): OrganizationSetupStep {
  return vue.steps.find((s) => s.id === id)!;
}

/** `faites` : `done` ; `reglees` : `done` ou `deferred` (« pas maintenant » n'est pas une faute). */
export function progression(vue: OrganizationSetupView): {
  faites: number;
  reglees: number;
  total: number;
} {
  return {
    faites: vue.steps.filter((s) => s.state === 'done').length,
    reglees: vue.steps.filter((s) => s.state !== 'todo').length,
    total: vue.steps.length,
  };
}

/** Terminé : toutes les étapes faites ou reportées (critère 18). */
export function termine(vue: OrganizationSetupView): boolean {
  return vue.steps.every((s) => s.state !== 'todo');
}

/**
 * Où reprendre : la première étape à faire que l'appelant peut faire ; sinon la première à
 * faire (il verra qui peut la faire) ; si tout est réglé, la dernière.
 */
export function etapeDeReprise(vue: OrganizationSetupView): EtapeId {
  const aFaire = ORGANIZATION_SETUP_STEP_IDS.filter((id) => etapeVue(vue, id).state === 'todo');
  return aFaire.find((id) => etapeVue(vue, id).canAct) ?? aFaire[0] ?? 'modules';
}

/** Étape demandée par l'URL (`?etape=`), ou `null` si absente ou inconnue. */
export function etapeDepuisParam(param: string | null): EtapeId | null {
  return ETAPES.some((e) => e.id === param) ? (param as EtapeId) : null;
}

export function etapeSuivante(id: EtapeId): EtapeId | null {
  const i = ETAPES.findIndex((e) => e.id === id);
  return ETAPES[i + 1]?.id ?? null;
}

export function etapePrecedente(id: EtapeId): EtapeId | null {
  const i = ETAPES.findIndex((e) => e.id === id);
  return i > 0 ? ETAPES[i - 1]!.id : null;
}

/** « Pas maintenant » offert : étape reportable (§ 4), à faire, et ouverte à l'appelant. */
export function peutReporter(step: OrganizationSetupStep): boolean {
  return isDeferrableStep(step.id) && step.state === 'todo' && step.canAct;
}

/** Un report peut être retiré par qui a l'action de l'étape. */
export function peutReprendre(step: OrganizationSetupStep): boolean {
  return step.state === 'deferred' && step.canAct;
}

/** État dessiné par l'indicateur d'étapes, avec une phrase courte. */
export function etatsAffiches(
  vue: OrganizationSetupView,
  courante: EtapeId,
): Array<{ etape: Etape; etat: StepState; hint?: string }> {
  return ETAPES.map((etape) => {
    const s = etapeVue(vue, etape.id);
    const verrou = s.requiredFor.includes('invoice') && s.state !== 'done';
    const hint =
      s.state === 'deferred'
        ? `${etape.report ?? 'Pas maintenant'} — reprenable`
        : !s.canAct && s.state === 'todo'
          ? `Faite par ${etape.quiPeut}`
          : verrou
            ? 'Nécessaire pour facturer'
            : undefined;
    const etat: StepState =
      etape.id === courante
        ? 'current'
        : s.state === 'done'
          ? 'done'
          : !s.canAct && s.state === 'todo'
            ? 'locked'
            : 'todo';
    return hint ? { etape, etat, hint } : { etape, etat };
  });
}

// ─── Capacités : facturer, normaliser, tenir les livres (§ 3) ────────────────

export interface Pastille {
  id: OrganizationSetupCapability;
  label: string;
  pret: boolean;
  /** Phrase d'état, sans reproche quand l'étape est volontairement reportée. */
  phrase: string;
  /** Ce qui manque, en mots, repris des codes du serveur. */
  manques: string[];
  /** Étape où agir. */
  etape: EtapeId;
}

const ETAPE_DE_CAPACITE: Record<OrganizationSetupCapability, EtapeId> = {
  invoice: 'fiscal',
  normalize: 'normalisation',
  accounting_active: 'comptabilite',
};

const LIBELLE_CAPACITE: Record<OrganizationSetupCapability, string> = {
  invoice: 'Facturer',
  normalize: 'Normaliser',
  accounting_active: 'Comptabilité',
};

export function pastilles(vue: OrganizationSetupView): Pastille[] {
  const { invoice, normalize, accounting_active: compta } = vue.capabilities;
  const reportee = (id: EtapeId) => etapeVue(vue, id).state === 'deferred';
  return [
    {
      id: 'invoice',
      label: LIBELLE_CAPACITE.invoice,
      pret: invoice.ready,
      phrase: invoice.ready
        ? 'Vous pouvez émettre vos factures.'
        : 'Aucune facture ne peut être émise tant que la fiche fiscale manque.',
      manques: invoice.missing.map(() => 'Enregistrer la fiche fiscale de l’organisation.'),
      etape: ETAPE_DE_CAPACITE.invoice,
    },
    {
      id: 'normalize',
      label: LIBELLE_CAPACITE.normalize,
      pret: normalize.ready,
      phrase: normalize.ready
        ? 'Vos factures peuvent être normalisées par la DGI.'
        : reportee('normalisation')
          ? 'Facture normalisée : pas maintenant.'
          : normalize.enabled
            ? 'Facture normalisée activée, mais une condition n’est plus remplie.'
            : normalize.missing.length === 0
              ? 'Tout est prêt pour activer la facture normalisée.'
              : 'Facultatif : la facture normalisée n’est pas activée.',
      manques: normalize.missing.map(libellePrerequis),
      etape: ETAPE_DE_CAPACITE.normalize,
    },
    {
      id: 'accounting_active',
      label: LIBELLE_CAPACITE.accounting_active,
      pret: compta.active,
      phrase: compta.active
        ? 'La comptabilité est active.'
        : reportee('comptabilite')
          ? 'Comptabilité : pas maintenant.'
          : compta.ready
            ? 'Tout est prêt pour activer la comptabilité.'
            : 'Facultatif : la comptabilité n’est pas active.',
      manques: compta.active ? [] : compta.missing.map((c) => LIBELLES_CONDITION[c]),
      etape: ETAPE_DE_CAPACITE.accounting_active,
    },
  ];
}

export const MISE_EN_ROUTE_BASE = '/organisation/mise-en-route';

export function lienEtape(id: EtapeId): string {
  return `${MISE_EN_ROUTE_BASE}?etape=${id}`;
}

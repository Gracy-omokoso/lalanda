// Contrat du coffre de portée ORGANISATION — ADR-0021 §4.2 et §11 (jalon A0).
//
// Pourquoi un port et non directement le service : le chantier B (`fiscal/`) code
// et teste contre ce contrat avec un faux coffre en mémoire, pendant que le
// chantier A écrit l'implémentation réelle (`organization-secrets.service.ts`).
// Les deux se rejoignent par le jeton d'injection `ORGANIZATION_SECRETS` : B ne
// dépend jamais de la classe concrète, donc jamais de la clé maîtresse.
//
// Pourquoi un service DISTINCT de `SecretsService` (ADR-0021 O3) : chaque méthode
// exige une organisation. Il est impossible d'appeler la résolution plateforme
// pour un secret d'organisation, ou l'inverse — ce n'est pas une règle à
// respecter, c'est une signature qui ne compile pas.
//
// Ce fichier ne contient AUCUNE logique : il ne change plus sans accord du CTO.

import type { ClientSession } from 'mongoose';

import type { Secret } from './secret-value.js';

/**
 * Natures de secret d'organisation — liste fermée.
 *
 * Un seul élément aujourd'hui : le jeton e-MCF d'un point de vente (ADR-0021 §4.1).
 * Le jeton est lié à UN e-MCF, pas au contribuable : d'où `ownerId` ci-dessous.
 */
export const ORGANIZATION_SECRET_KINDS = ['dgi_emcf_token'] as const;
export type OrganizationSecretKind = (typeof ORGANIZATION_SECRET_KINDS)[number];

/** Adresse d'un secret : organisation, nature, objet propriétaire (le point de vente). */
export interface OrganizationSecretRef {
  organizationId: string;
  kind: OrganizationSecretKind;
  ownerId: string;
}

/**
 * Description publiable d'un secret — jamais sa valeur.
 *
 * `last4` suit la règle d'ADR-0013 §4 : les 4 derniers caractères, `null` sous
 * 12 caractères (trop court, 4 caractères en révéleraient une part excessive).
 */
export interface OrganizationSecretDescription {
  configured: boolean;
  last4: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export interface OrganizationSecretsPort {
  /**
   * Chiffre et enregistre (crée ou remplace). `session` inscrit l'écriture dans la
   * transaction de l'appelant, avec le document du point de vente et l'événement
   * d'audit strict (ADR-0021 §4.1) : les trois aboutissent ensemble ou pas du tout.
   */
  put(
    ref: OrganizationSecretRef,
    value: string,
    actorUserId: string,
    opts?: { session?: ClientSession },
  ): Promise<OrganizationSecretDescription>;

  /**
   * Déchiffre. `null` si aucun secret n'est enregistré. Lève
   * `VaultUnavailableError` si le coffre n'est pas configuré — jamais de secours
   * par une variable d'environnement (ADR-0021 §4.2). Un chiffré indéchiffrable
   * fait remonter son erreur (panne bruyante, ADR-0013 §3).
   */
  resolve(ref: OrganizationSecretRef): Promise<Secret | null>;

  describe(ref: OrganizationSecretRef): Promise<OrganizationSecretDescription>;

  /** Descriptions groupées — une lecture pour toute la liste des points de vente. */
  describeMany(
    organizationId: string,
    kind: OrganizationSecretKind,
    ownerIds: readonly string[],
  ): Promise<Map<string, OrganizationSecretDescription>>;

  /** Détruit le chiffré (retrait d'un point de vente). Sans effet s'il n'existe pas. */
  destroy(ref: OrganizationSecretRef, opts?: { session?: ClientSession }): Promise<void>;
}

/** Jeton d'injection Nest — à utiliser avec `@Inject(ORGANIZATION_SECRETS)`. */
export const ORGANIZATION_SECRETS = Symbol('ORGANIZATION_SECRETS');

/**
 * Coffre non configuré (`SECRETS_MASTER_KEY` absente). Traduite en
 * `503 VAULT_UNAVAILABLE` par les contrôleurs (ADR-0021 §10).
 */
export class VaultUnavailableError extends Error {
  readonly code = 'VAULT_UNAVAILABLE';

  constructor(message = 'Coffre à secrets indisponible : la clé maîtresse n’est pas configurée.') {
    super(message);
    this.name = 'VaultUnavailableError';
  }
}

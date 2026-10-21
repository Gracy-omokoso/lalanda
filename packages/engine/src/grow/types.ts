// ─────────────────────────────────────────────────────────────────────────────
// GROW — types partagés (ADR-0032)
//
// Le module GROW du moteur LIT des données déjà observées (réalisé BUILD clôturé,
// ventes RUN finales, solde déclaré) et rend des indicateurs, un score de santé et
// une étape suggérée. Il n'a ni horloge (la date du calcul est un paramètre), ni
// accès base, ni texte produit par une IA.
//
// Règle cardinale (docs/08) : une valeur impossible à établir est rendue
// `disponible: false` avec un code de raison et une phrase — jamais un `0`.
// ─────────────────────────────────────────────────────────────────────────────

/** Version des calculs GROW. Changer un seuil, une fenêtre ou une règle = nouvelle version. */
export const GROW_VERSION = '1.0.0';

/** Date civile `AAAA-MM-JJ`. */
export type GrowDate = string;
/** Mois civil `AAAA-MM`. */
export type GrowMonth = string;

/** Origine d'une donnée lue par GROW (ADR-0032 § 2). */
export type GrowSource = 'build.actuals' | 'run.sales' | 'grow.declared_cash';

export interface GrowSourceRef {
  source: GrowSource;
  /** Libellé lisible : « Réalisé clôturé du projet « Boulangerie » », « Ventes (USD) »… */
  libelle: string;
}

export interface GrowPeriod {
  /** Libellé lisible : « 3 derniers mois clôturés (E1-M04 à E1-M06) ». */
  libelle: string;
  /** Mois couverts, dans l'ordre chronologique (`AAAA-MM` ou `E1-M04`). */
  mois: readonly string[];
}

// ─── Entrées ─────────────────────────────────────────────────────────────────

/** Une période réalisée (docs/08), telle que lue dans `actual_periods`. */
export interface GrowActualPeriod {
  /** Exercice 1 à 5. */
  year: number;
  /** Mois d'exercice 1 à 12. */
  month: number;
  status: 'open' | 'closed';
  /** Instant ISO de la clôture, `null` si jamais clôturée. */
  closedAt: string | null;
  values: Readonly<Record<string, number>>;
}

/**
 * Réalisé BUILD du projet de référence (ADR-0032 O2), ou la raison de son absence.
 * `selection` dit comment le projet a été retenu : choisi par l'utilisateur, ou seul
 * projet de l'organisation.
 */
export type GrowActualsSource =
  | {
      kind: 'project';
      projectId: string;
      projectName: string;
      currency: string;
      selection: 'declared' | 'only_project';
      periods: readonly GrowActualPeriod[];
    }
  | { kind: 'none'; reason: 'AUCUN_PROJET' | 'PROJET_DE_REFERENCE_A_CHOISIR' };

/** Types de document de vente e-DEF (ADR-0023). */
export type GrowSalesDocumentType = 'FV' | 'FT' | 'FA' | 'EV' | 'ET' | 'EA';

/** Montants HT par groupe d'un document, dans une devise donnée. */
export interface GrowSalesAmounts {
  currency: string;
  groups: readonly { group: string; ht: string }[];
}

/** Document de vente, réduit à ce que GROW lit. */
export interface GrowSalesDocument {
  id: string;
  type: GrowSalesDocumentType;
  status: string;
  series: string | null;
  /** Instant ISO d'émission ; `null` pour un brouillon. */
  issuedAt: string | null;
  /** Identifiant du client au fichier clients ; `null` = client non identifié. */
  customerKey: string | null;
  customerName: string | null;
  /**
   * Représentations disponibles : d'abord celle de la devise du document, puis, pour
   * une facture normalisée, ses montants CDF normalisés (docs/21 : les seuls qui ont
   * valeur fiscale). Aucune conversion n'est faite par GROW.
   */
  amounts: readonly GrowSalesAmounts[];
  /** `catalogItemId` de chaque ligne (`null` = ligne libre). */
  lineCatalogItemIds: readonly (string | null)[];
}

/** Solde de trésorerie déclaré par l'utilisateur dans GROW (hypothèse, ADR-0032 § 1). */
export interface GrowDeclaredCash {
  amount: number;
  currency: string;
  asOf: GrowDate;
}

export interface GrowInputs {
  /** Date du calcul (Kinshasa). Paramètre : le moteur ne lit pas l'horloge. */
  asOf: GrowDate;
  actuals: GrowActualsSource;
  sales: readonly GrowSalesDocument[];
  declaredCash: GrowDeclaredCash | null;
  /** Articles du catalogue déclarés « revenu récurrent » dans GROW (ADR-0032 O3). */
  recurringCatalogItemIds: readonly string[];
}

// ─── Indicateurs ─────────────────────────────────────────────────────────────

export type GrowIndicatorCode =
  | 'mrr'
  | 'arr'
  | 'burn_rate'
  | 'runway'
  | 'croissance_ventes'
  | 'croissance_ca_realise'
  | 'marge_brute'
  | 'marge_nette'
  | 'concentration_clients'
  | 'clients_revenants';

/** Unité : un `ratio` est une fraction (`0.05` = 5 %), comme `ecartPct` (docs/08). */
export type GrowUnit = 'montant' | 'ratio' | 'mois';

export interface GrowTopCustomer {
  rang: number;
  /** Identifiant au fichier clients. */
  cle: string;
  /** Nom du client — retiré par l'API pour un appelant sans `sales.read`. */
  nom: string | null;
  montant: number;
  part: number;
}

export interface GrowIndicatorAvailable {
  code: GrowIndicatorCode;
  libelle: string;
  disponible: true;
  valeur: number;
  unite: GrowUnit;
  /** Devise d'un montant ; `null` pour un ratio ou une durée. */
  devise: string | null;
  sources: readonly GrowSourceRef[];
  periode: GrowPeriod;
  /** La formule, en une phrase. */
  methode: string;
  /** Hypothèses et limites, toujours affichées avec la valeur. */
  hypotheses: readonly string[];
  /** Concentration seulement : les trois premiers clients. */
  premiersClients?: readonly GrowTopCustomer[];
  /** Concentration seulement : part des trois premiers clients. */
  partTroisPremiers?: number;
}

export interface GrowIndicatorUnavailable {
  code: GrowIndicatorCode;
  libelle: string;
  disponible: false;
  /** Code stable (SCREAMING_SNAKE_CASE). */
  raison: string;
  message: string;
  sources: readonly GrowSourceRef[];
  hypotheses: readonly string[];
}

export type GrowIndicator = GrowIndicatorAvailable | GrowIndicatorUnavailable;

/** Faits établis en lisant les données, consommés par le score et le parcours. */
export interface GrowFacts {
  /** Devise dans laquelle les ventes sont lues, ou `null` si indéterminée. */
  devise: string | null;
  projet: { id: string; nom: string; selection: 'declared' | 'only_project' } | null;
  /** Mois réalisés clôturés du projet de référence. */
  moisClotures: number;
  /** Instant ISO de la clôture la plus récente. */
  derniereCloture: string | null;
  /** Au moins un mois clôturé avec `ca` > 0. */
  caRealisePositif: boolean;
  /** Documents de vente retenus (dans la devise de référence). */
  documentsRetenus: number;
  /** Documents exclus, par motif — affichés, jamais silencieux. */
  documentsExclus: {
    acomptes: number;
    serieEssai: number;
    autreDevise: number;
  };
  /** Premier mois civil de vente, `null` sans vente. */
  premiereVente: GrowMonth | null;
  /** Clients identifiés au CA net > 0 sur les 12 derniers mois civils complets. */
  clientsDistincts12Mois: number;
  /** Dernier mois civil complet avant la date du calcul. */
  dernierMoisComplet: GrowMonth;
}

export interface GrowIndicatorsResult {
  growVersion: string;
  asOf: GrowDate;
  indicateurs: Readonly<Record<GrowIndicatorCode, GrowIndicator>>;
  faits: GrowFacts;
}

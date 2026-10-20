// Preuves de comportement de la DGI pour le rattrapage — ADR-0024 § 4.2 et § 7.4.
//
// La documentation de la DGI ne dit pas si `GET /api/invoice/{uid}` décrit une
// facture FINALISÉE (avec ses éléments de sécurité). Tant que ce fait n'est pas
// OBSERVÉ en environnement de test (sous-commande `probe`, chantier F4) ET
// confirmé PAR ÉCRIT par la DGI (question DGI n° 1), le rattrapage choisit
// l'interprétation prudente : une confirmation restée sans réponse, dont la
// lecture ne montre pas d'éléments de sécurité, finit en « vérification
// nécessaire » — jamais en « non normalisée » automatique.
//
// Ce relevé ne se modifie qu'avec sa source (rapport de sonde daté, référence du
// courrier DGI) et une revue CTO.

export interface ReconciliationEvidence {
  environment: 'test';
  /** 'AAAA-MM-JJ' de l'observation, `null` tant qu'elle n'a pas eu lieu. */
  observedAt: string | null;
  /** Référence de la réponse écrite de la DGI, `null` tant qu'elle n'existe pas. */
  dgiWrittenAnswer: string | null;
  source: string;
  /**
   * Vrai SEULEMENT si observé ET confirmé par écrit : une lecture sans éléments
   * de sécurité après une confirmation sans réponse prouve alors que la facture
   * n'a PAS été normalisée.
   */
  detailsWithoutSecurityMeansNotNormalized: boolean;
}

export const EDEF_RECONCILIATION_EVIDENCE: Readonly<ReconciliationEvidence> = Object.freeze({
  environment: 'test',
  observedAt: null,
  dgiWrittenAnswer: null,
  source: 'Non observé ; question DGI n° 1 (ADR-0024) sans réponse au 2026-10-19.',
  detailsWithoutSecurityMeansNotNormalized: false,
});

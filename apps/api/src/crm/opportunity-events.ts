// Point d'extension des événements d'opportunité (ADR-0040 § 6.4). ADR-0040 — C2.
//
// Une opportunité passée en `won` (déplacement manuel ou devis accepté) appelle
// `onWon` APRÈS l'écriture. Par défaut, rien ne se passe : la notification
// `crm.opportunity_won` (type déclaré par C4, envoyée par C7) se branche en
// remplaçant ce fournisseur dans `crm.module.ts`, sans toucher au service.
// Valeur retenue par la dirigeante (décision ouverte n° 13) : la notification va
// au SEUL responsable de l'opportunité (`ownerId`).
//
// Contrat : l'implémentation est idempotente par (opportunité, passage en gagné)
// et ne lève pas — une erreur est journalisée par l'appelant, jamais propagée à
// l'écriture de l'opportunité, déjà faite.

export const CRM_OPPORTUNITY_EVENTS = Symbol('CRM_OPPORTUNITY_EVENTS');

export interface OpportunityWonEvent {
  organizationId: string;
  opportunityId: string;
  /** Destinataire de la notification « opportunité gagnée ». */
  ownerId: string | null;
  actorUserId: string;
  source: 'user' | 'quote';
  quoteId: string | null;
  wonAt: Date;
}

export interface CrmOpportunityEvents {
  onWon(event: OpportunityWonEvent): Promise<void>;
}

/** Fournisseur par défaut : aucun effet. */
export const NO_OPPORTUNITY_EVENTS: CrmOpportunityEvents = Object.freeze({
  async onWon(): Promise<void> {},
});

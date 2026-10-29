// PONT TEMPORAIRE — à supprimer avec le dossier `ventes/crm/` (ADR-0040 § 8.1).
//
// Le CRM a déménagé sous `(app)/crm/**` (lot C5). `ventes/devis/_components/
// quote-detail.tsx`, qui appartient au lot C0, importe encore `CRM_BASE` depuis
// ce chemin pour construire `${CRM_BASE}/<id>` vers la fiche d'opportunité. Ce
// fichier garde l'import valide sans toucher aux devis, et fait pointer ce lien
// sur la nouvelle fiche `/crm/opportunites/<id>`.
//
// Quand C0 est fusionné, `quote-detail.tsx` doit importer `lienOpportunite`
// depuis `(app)/crm/_components/crm-model` et ce fichier disparaît. Ce n'est
// pas une route : `_components` est un dossier privé de Next.

export const CRM_BASE = '/crm/opportunites';

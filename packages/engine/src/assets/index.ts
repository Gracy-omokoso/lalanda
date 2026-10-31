// Équipements (ADR-0046 § 7.2) — point d'entrée du module. Versionné à part
// (`ASSETS_VERSION`) ; n'écrit dans aucun réalisé, plan, scénario ni trésorerie,
// et ne pose aucune règle comptable ou fiscale. `money.ts` reste interne.

export * from './types.js';
export { managementDepreciationEstimate, managementDepreciationSchedule } from './depreciation.js';
export { assetDeadlines, expiryStatus, nextMaintenanceDate } from './deadlines.js';
export { assetRegisterSummary, assetTotalCostOfOwnership } from './register.js';
export { assigneeOn, assignmentHistory, checkNewAssignment } from './assignments.js';

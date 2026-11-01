// Comptabilité SYSCOHADA (projet à valider) — point d'entrée du module
// (ADR-0049 § 12). Module PUR, versionné à part (`ACCOUNTING_VERSION`).
//
// Fichier partagé (ADR-0049 § Zones de conflit) : K2 le crée ; K1 et K3 y
// ajoutent chacun leurs exports sous leur propre commentaire `// ADR-0049 — K1`
// ou `// ADR-0049 — K3`.

// ADR-0049 — K2 : types communs, règles de correspondance, moteur d'écritures.
export * from './types.js';
export * from './rules/index.js';
export * from './entries/index.js';

// ADR-0049 — K1 : pack de plan comptable (lecture, validation, empreinte).
export * from './chart/index.js';

// ADR-0049 — K3 : grand livre, balances, lettrage, états, clôtures, rapprochement, exports.
export * from './ledger/index.js';
export * from './statements/index.js';
export * from './closing/index.js';
export * from './reconciliation/index.js';
export * from './export/index.js';

// ADR-0049 — raccord K2/K3 : écriture K2 enregistrée → vue de restitution K3.
export * from './bridge.js';

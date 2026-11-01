// Exports pour l'expert-comptable (ADR-0049 § 9, § 13) : choix du format, période,
// historique avec empreintes. Logique pure. Le format exact reste une décision ouverte
// (n° 14) : l'écran propose ce que l'ADR retient par défaut, sans rien présumer de
// l'outil de l'expert.

import { ACCOUNTING_SIMULATION_EXPORT_MARK } from '@lalanda/shared/accounting';

import type {
  AccountingExportFormat,
  AccountingExportKind,
  AccountingExportView,
} from '@/lib/api-accounting';

export const TYPES_EXPORT: readonly {
  kind: AccountingExportKind;
  libelle: string;
  formats: readonly AccountingExportFormat[];
}[] = [
  { kind: 'entries', libelle: 'Écritures, une ligne par ligne d’écriture', formats: ['csv'] },
  { kind: 'trial-balance', libelle: 'Balance générale', formats: ['csv', 'xlsx'] },
  {
    kind: 'auxiliary-balance',
    libelle: 'Balances clients et fournisseurs',
    formats: ['csv', 'xlsx'],
  },
  { kind: 'ledger', libelle: 'Grand livre', formats: ['csv', 'xlsx'] },
  { kind: 'statements', libelle: 'Projets d’états', formats: ['pdf', 'xlsx'] },
  { kind: 'reserves', libelle: 'État des réserves', formats: ['csv'] },
];

export const LIBELLES_FORMAT: Record<AccountingExportFormat, string> = {
  csv: 'CSV (point-virgule, UTF-8)',
  xlsx: 'Classeur Excel (.xlsx)',
  pdf: 'PDF',
};

export function formatsDe(kind: AccountingExportKind): readonly AccountingExportFormat[] {
  return TYPES_EXPORT.find((t) => t.kind === kind)?.formats ?? [];
}

export function libelleExport(kind: AccountingExportKind): string {
  return TYPES_EXPORT.find((t) => t.kind === kind)?.libelle ?? kind;
}

/** Libellé d'une ligne d'historique ; la marque « SIMULATION » en tête quand il y a lieu. */
export function titreExport(e: Pick<AccountingExportView, 'kind' | 'simulation'>): string {
  const base = libelleExport(e.kind);
  return e.simulation ? `${ACCOUNTING_SIMULATION_EXPORT_MARK} — ${base}` : base;
}

/** Empreinte abrégée pour l'affichage (le texte complet reste en infobulle). */
export function empreinteCourte(sha256: string): string {
  return sha256.length > 16 ? `${sha256.slice(0, 8)}…${sha256.slice(-8)}` : sha256;
}

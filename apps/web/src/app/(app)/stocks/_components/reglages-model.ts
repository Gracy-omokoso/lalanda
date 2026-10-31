// Réglages des stocks — ADR-0046 § 2.8. Logique pure : formulaire et corps de
// `PUT /stock/settings` (`stock.manage`). Lecture ouverte à `stock.read`.

import { STOCK_LIMITS } from '@lalanda/shared/stock';

import type {
  StockAdjustmentReasonView,
  StockSalesIssueMode,
  StockSettingsInput,
  StockSettingsView,
} from '@/lib/api-stock';

export const LIBELLES_MODE_VENTE: Record<StockSalesIssueMode, { titre: string; aide: string }> = {
  automatic: {
    titre: 'Automatique',
    aide: 'Toute facture de vente émise sort du stock les articles liés, quelques minutes après.',
  },
  proposed: {
    titre: 'Proposée',
    aide: 'Chaque ligne vendue arrive dans « À traiter » : quelqu’un confirme la sortie.',
  },
  off: { titre: 'Éteinte', aide: 'Les ventes ne touchent pas au stock.' },
};

export interface FormulaireReglages {
  salesIssueMode: StockSalesIssueMode;
  allowNegativeManualMoves: boolean;
  countReminderDays: string;
  motifs: StockAdjustmentReasonView[];
}

export function formulaireReglages(v: StockSettingsView): FormulaireReglages {
  return {
    salesIssueMode: v.salesIssueMode,
    allowNegativeManualMoves: v.allowNegativeManualMoves,
    countReminderDays: String(v.countReminderDays),
    motifs: v.adjustmentReasons.map((m) => ({ ...m })),
  };
}

/** Clé stable d'un motif nouveau, tirée de son libellé (« Perte en route » → `perte_en_route`). */
export function cleMotif(label: string, existantes: readonly string[]): string {
  const base =
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'motif';
  let cle = base;
  let n = 2;
  while (existantes.includes(cle)) cle = `${base}_${n++}`;
  return cle;
}

export function preparerReglages(
  f: FormulaireReglages,
  revision: number,
): { ok: true; corps: StockSettingsInput } | { ok: false; champs: Record<string, string> } {
  const champs: Record<string, string> = {};
  const jours = f.countReminderDays.trim();
  if (!/^\d{1,3}$/.test(jours) || Number(jours) > STOCK_LIMITS.countReminderDaysMax) {
    champs['countReminderDays'] = 'Un nombre entier de jours, de 0 (aucun rappel) à 365.';
  }
  if (f.motifs.length === 0) champs['motifs'] = 'Gardez au moins un motif d’ajustement.';
  if (f.motifs.length > STOCK_LIMITS.adjustmentReasons) champs['motifs'] = '20 motifs au plus.';
  const motifs: StockAdjustmentReasonView[] = [];
  f.motifs.forEach((m, i) => {
    const label = m.label.trim();
    if (label === '') champs[`motif-${i}`] = 'Libellé obligatoire.';
    else if (label.length > STOCK_LIMITS.adjustmentReasonLabel)
      champs[`motif-${i}`] = '60 caractères au plus.';
    else motifs.push({ key: m.key, label });
  });
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      salesIssueMode: f.salesIssueMode,
      allowNegativeManualMoves: f.allowNegativeManualMoves,
      countReminderDays: Number(jours),
      adjustmentReasons: motifs,
      expectedRevision: revision,
    },
  };
}

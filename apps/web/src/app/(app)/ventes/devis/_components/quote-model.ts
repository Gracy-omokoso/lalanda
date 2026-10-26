// Logique pure des écrans Devis — ADR-0035 § 1 et § 5.
//
// Un devis porte les MÊMES lignes qu'un brouillon de facture : le formulaire
// des lignes et sa préparation sont ceux des factures (`invoice-model.ts`), le
// calcul vient de l'API (moteur). Aucun montant n'est calculé ici.

import type { InvoiceView } from '@/lib/api';
import type { QuoteBody, QuoteStatus, QuoteView } from '@/lib/api-crm';

import {
  formulaireDepuisVue,
  formulaireVide,
  preparerDocument,
  type FormulaireDocument,
} from '../../factures/_components/invoice-model';

export const DEVIS_BASE = '/ventes/devis';

/** Intitulé imprimé : un devis n'est jamais une facture, ni un pro forma. */
export const LIBELLE_DEVIS = 'DEVIS — non valable comme facture';

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Brouillon',
  sent: 'Envoyé',
  accepted: 'Accepté',
  refused: 'Refusé',
  expired: 'Expiré',
};

export const FILTRES_DEVIS: readonly { valeur: QuoteStatus | 'all'; label: string }[] = [
  { valeur: 'all', label: 'Tous' },
  { valeur: 'draft', label: 'Brouillons' },
  { valeur: 'sent', label: 'Envoyés' },
  { valeur: 'accepted', label: 'Acceptés' },
  { valeur: 'refused', label: 'Refusés' },
  { valeur: 'expired', label: 'Expirés' },
];

export function tonDevis(s: QuoteStatus): 'neutre' | 'attention' {
  return s === 'expired' || s === 'refused' ? 'attention' : 'neutre';
}

export const ISSUE_GAIN: Record<NonNullable<QuoteView['opportunityOutcome']>, string> = {
  won: 'L’opportunité rattachée est passée à « gagnée ».',
  disabled: 'Règle de gain désactivée : l’opportunité rattachée n’a pas changé.',
  not_open: 'L’opportunité rattachée était déjà close : elle n’a pas changé.',
  none: 'Aucune opportunité rattachée.',
};

export interface MetaDevis {
  title: string;
  notes: string;
  /** `AAAA-MM-JJ` ; vide : validité par défaut (30 jours). */
  validUntil: string;
  opportunityId: string | null;
}

/**
 * Formulaire de lignes et de client d'un devis servi par l'API. Le devis porte
 * les formes d'un brouillon de facture ; les champs propres à la facture
 * (paiements, commentaires, avoir, point de vente) sont neutres.
 */
export function formulaireDepuisDevis(q: QuoteView): FormulaireDocument {
  const commeFacture = {
    ...q,
    type: 'FV',
    comments: { A: null, C: null },
    creditNote: null,
    showUsdCounterValue: false,
    pointOfSaleId: null,
    documentAmounts: { ...q.documentAmounts, payments: [] },
  } as unknown as InvoiceView;
  return formulaireDepuisVue(commeFacture);
}

export function formulaireDevisVide(): FormulaireDocument {
  return { ...formulaireVide(), paiements: [] };
}

export function metaDepuisDevis(
  q: QuoteView | null,
  opportunityId: string | null = null,
): MetaDevis {
  return {
    title: q?.title ?? '',
    notes: q?.notes ?? '',
    validUntil: q?.validUntil ?? '',
    opportunityId: q?.opportunity?.id ?? opportunityId,
  };
}

export type PreparationDevis =
  { ok: true; corps: QuoteBody } | { ok: false; champs: Record<string, string> };

/** Contrôle de forme (celui des factures) puis corps du devis. */
export function preparerDevis(f: FormulaireDocument, m: MetaDevis): PreparationDevis {
  const doc = preparerDocument({ ...f, type: 'FV', paiements: [], nature: null });
  const champs: Record<string, string> = doc.ok ? {} : { ...doc.champs };
  if (m.validUntil !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(m.validUntil)) {
    champs['validUntil'] = 'Date de validité : AAAA-MM-JJ.';
  }
  if (m.title.length > 200) champs['title'] = '200 caractères au plus.';
  if (m.notes.length > 1000) champs['notes'] = '1 000 caractères au plus.';
  if (!doc.ok || Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      opportunityId: m.opportunityId,
      title: m.title.trim() === '' ? null : m.title.trim(),
      notes: m.notes.trim() === '' ? null : m.notes.trim(),
      validUntil: m.validUntil === '' ? null : m.validUntil,
      currency: doc.corps.currency,
      priceMode: doc.corps.priceMode,
      customer: doc.corps.customer,
      lines: doc.corps.lines,
    },
  };
}

/** `"2026-11-20"` → `20/11/2026`. */
export function formatJour(jour: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(jour);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : jour;
}

const MESSAGES_DEVIS: Record<string, string> = {
  QUOTE_STATUS_CONFLICT:
    'Cette action n’est plus possible dans l’état actuel du devis : rechargez-le.',
  QUOTE_NOT_READY: 'Ce devis ne peut pas encore être envoyé : corrigez les points signalés.',
  QUOTE_NOT_DELETABLE: 'Seul un devis jamais envoyé se supprime ; sinon, marquez-le refusé.',
  QUOTE_ALREADY_CONVERTED: 'Ce devis a déjà été converti : ouvrez la facture créée.',
  QUOTE_NOT_FOUND: 'Ce devis est introuvable.',
  CRM_OPPORTUNITY_NOT_FOUND: 'L’opportunité rattachée est introuvable.',
  DOCUMENT_NOT_PRINTABLE:
    'Le calcul de ce devis présente des erreurs : corrigez-le avant de l’imprimer.',
  STALE_REVISION: 'Ce devis a été modifié entre-temps : rechargez la page, puis recommencez.',
  INVALID_REQUEST: 'Certaines valeurs sont refusées. Vérifiez les champs signalés.',
};

export function messageDevis(err: unknown, repli: string): string {
  if (typeof err !== 'object' || err === null) return repli;
  const e = err as { status?: unknown; detail?: unknown };
  if (e.status === 403) return 'Votre rôle ne permet pas cette action sur les devis.';
  const detail =
    typeof e.detail === 'object' && e.detail !== null
      ? (e.detail as Record<string, unknown>)
      : null;
  const code = typeof detail?.['code'] === 'string' ? (detail['code'] as string) : null;
  if (code && MESSAGES_DEVIS[code]) return MESSAGES_DEVIS[code]!;
  if (typeof detail?.['message'] === 'string') return detail['message'] as string;
  return repli;
}

/** Problèmes champ par champ d'un refus 400 (`details.issues`). */
export function champsRefuses(err: unknown): Record<string, string> {
  const issues = (err as { detail?: { details?: { issues?: unknown } } } | null)?.detail?.details
    ?.issues;
  if (!Array.isArray(issues)) return {};
  const out: Record<string, string> = {};
  for (const i of issues) {
    if (typeof i === 'object' && i !== null && 'path' in i && 'message' in i) {
      out[String((i as { path: unknown }).path)] = String((i as { message: unknown }).message);
    }
  }
  return out;
}

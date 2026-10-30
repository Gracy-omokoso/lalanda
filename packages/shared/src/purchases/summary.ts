// Résumé des achats — `GET /purchases/summary?from=&to=` (ADR-0044 § 3.6, § 7).
// ADR-0044 — P6.
//
// Montants rendus par le moteur (`purchasesSummary`), PAR DEVISE, par fournisseur
// et par catégorie, jamais convertis ni additionnés entre devises.
// - `committed` (engagé) : reste à facturer HT des commandes approuvées non closes,
//   À DATE (la période ne s'y applique pas : c'est un engagement en cours) ;
// - `invoiced`, `credited`, `paid`, `remaining` : factures VALIDÉES dont la date de
//   facture tombe dans la période (bornes incluses ; sans période : toutes).

import { z } from 'zod';

import { PurchaseCalendarDay } from './common.js';
import type { PurchaseCurrency } from './constants.js';

export const PurchasesSummaryQuery = z
  .object({
    from: PurchaseCalendarDay.optional(),
    to: PurchaseCalendarDay.optional(),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'Période inversée : `from` doit précéder `to`.',
    path: ['to'],
  });
export type PurchasesSummaryQuery = z.infer<typeof PurchasesSummaryQuery>;

export interface PurchasesSummaryFiguresView {
  committed: string;
  invoiced: string;
  credited: string;
  paid: string;
  remaining: string;
}

export interface PurchasesSummaryView {
  version: string;
  from: string | null;
  to: string | null;
  byCurrency: (PurchasesSummaryFiguresView & { currency: PurchaseCurrency })[];
  bySupplier: (PurchasesSummaryFiguresView & {
    supplierId: string;
    supplierName: string | null;
    currency: PurchaseCurrency;
  })[];
  byCategory: (PurchasesSummaryFiguresView & { category: string; currency: PurchaseCurrency })[];
  /** Lecture bornée atteinte : le résumé ne porte pas sur tous les documents. */
  truncated: boolean;
}

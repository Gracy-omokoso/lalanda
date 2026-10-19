// `/ventes/factures` — documents de vente : pro forma, factures, avoirs
// (S25e — ADR-0023). Lecture : `sales.read` ; brouillons : `sales.manage` ;
// émission et normalisation : `sales.invoice`.

import type { Metadata } from 'next';

import { InvoiceList } from './_components/invoice-list';

export const metadata: Metadata = { title: 'Factures — Ventes · Lalanda' };

export default function InvoicesPage(): React.ReactElement {
  return <InvoiceList />;
}

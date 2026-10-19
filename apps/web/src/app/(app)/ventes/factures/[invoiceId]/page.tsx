// `/ventes/factures/[invoiceId]` — un document de vente : brouillon modifiable,
// ou document figé à consulter (ADR-0023 § S25e.1).

import type { Metadata } from 'next';

import { InvoiceDetail } from '../_components/invoice-detail';

export const metadata: Metadata = { title: 'Document de vente — Ventes · Lalanda' };

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}): Promise<React.ReactElement> {
  const { invoiceId } = await params;
  return <InvoiceDetail invoiceId={invoiceId} />;
}

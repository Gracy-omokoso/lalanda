// `/ventes/devis/[quoteId]` — un devis (ADR-0035) : brouillon modifiable, ou suivi.

import type { Metadata } from 'next';

import { QuoteDetail } from '../_components/quote-detail';

export const metadata: Metadata = { title: 'Devis — Ventes · Lalanda' };

export default async function QuotePage({
  params,
}: {
  params: Promise<{ quoteId: string }>;
}): Promise<React.ReactElement> {
  const { quoteId } = await params;
  return <QuoteDetail quoteId={quoteId} />;
}

// `/ventes/devis` — devis (ADR-0035) : lecture `sales.read`, préparation `sales.manage`.

import type { Metadata } from 'next';

import { QuoteList } from './_components/quote-list';

export const metadata: Metadata = { title: 'Devis — Ventes · Lalanda' };

export default function QuotesPage(): React.ReactElement {
  return <QuoteList />;
}

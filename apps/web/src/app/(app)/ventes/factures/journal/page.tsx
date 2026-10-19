// `/ventes/factures/journal` — journal électronique des documents de vente
// (ADR-0023 § S25e.12). Lecture : `sales.read`.

import type { Metadata } from 'next';

import { JournalList } from '../_components/journal-list';

export const metadata: Metadata = { title: 'Journal — Ventes · Lalanda' };

export default function JournalPage(): React.ReactElement {
  return <JournalList />;
}

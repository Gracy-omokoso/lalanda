// `/ventes/clients` — fichier clients typé selon la DGI (S25c — ADR-0022).
// Lecture : `sales.read` ; écriture : `sales.manage`.

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { CustomerList } from '../_components/customer-list';

export const metadata: Metadata = { title: 'Clients — Ventes · Lalanda' };

export default function CustomersPage(): React.ReactElement {
  // `useSearchParams` (fiche ouverte : `?fiche=`) exige une frontière Suspense.
  return (
    <Suspense
      fallback={<p className="text-sm text-[var(--foreground-muted)]">Chargement des clients…</p>}
    >
      <CustomerList />
    </Suspense>
  );
}

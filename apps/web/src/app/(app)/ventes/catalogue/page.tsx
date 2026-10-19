// `/ventes/catalogue` — biens, services et taxes facturables (S25c — ADR-0022).
// Lecture : `sales.read` ; écriture : `sales.manage`.

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { CatalogList } from '../_components/catalog-list';

export const metadata: Metadata = { title: 'Catalogue — Ventes · Lalanda' };

export default function CatalogPage(): React.ReactElement {
  // `useSearchParams` (fiche ouverte : `?fiche=`) exige une frontière Suspense.
  return (
    <Suspense
      fallback={<p className="text-sm text-[var(--foreground-muted)]">Chargement du catalogue…</p>}
    >
      <CatalogList />
    </Suspense>
  );
}

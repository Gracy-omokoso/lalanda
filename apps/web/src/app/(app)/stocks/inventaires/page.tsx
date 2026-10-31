// `/stocks/inventaires` — inventaires (ADR-0046 § 2.7) ; lecture `stock.read`,
// création `stock.manage` (`?nouveau=1` ouvre la fenêtre).

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { InventairesListe } from '../_components/inventaires-liste';

export const metadata: Metadata = { title: 'Inventaires — Stocks · Lalanda' };

export default function InventairesPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <InventairesListe />
    </Suspense>
  );
}

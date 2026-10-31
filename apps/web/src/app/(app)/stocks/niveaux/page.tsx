// `/stocks/niveaux` — stock par emplacement (ADR-0046 § 2.5, § 5.1) ; lecture
// `stock.read`. `?emplacement=<id>` et `?seuil=1` filtrent.

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Niveaux } from '../_components/niveaux';

export const metadata: Metadata = { title: 'Niveaux — Stocks · Lalanda' };

export default function NiveauxPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <Niveaux />
    </Suspense>
  );
}

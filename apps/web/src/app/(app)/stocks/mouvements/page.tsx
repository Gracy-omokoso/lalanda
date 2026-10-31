// `/stocks/mouvements` — grand livre filtrable (ADR-0046 § 2.3, § 5.1) ;
// lecture `stock.read`. `?article=<id>` choisit l'article.

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Mouvements } from '../_components/mouvements';

export const metadata: Metadata = { title: 'Mouvements — Stocks · Lalanda' };

export default function MouvementsPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <Mouvements />
    </Suspense>
  );
}

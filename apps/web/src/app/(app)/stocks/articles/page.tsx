// `/stocks/articles` — articles stockés (ADR-0046 § 2.1) ; lecture `stock.read`,
// création `stock.manage` (`?nouveau=1` ouvre la fenêtre).

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ArticlesListe } from '../_components/articles-liste';

export const metadata: Metadata = { title: 'Articles — Stocks · Lalanda' };

export default function ArticlesPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <ArticlesListe />
    </Suspense>
  );
}

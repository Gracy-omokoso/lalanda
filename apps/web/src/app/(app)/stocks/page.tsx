// `/stocks` — vue d'ensemble des stocks (ADR-0046 § 5.1) ; lecture `stock.read`.

import type { Metadata } from 'next';

import { VueEnsemble } from './_components/vue-ensemble';

export const metadata: Metadata = { title: 'Stocks — Lalanda' };

export default function StocksPage(): React.ReactElement {
  return <VueEnsemble />;
}

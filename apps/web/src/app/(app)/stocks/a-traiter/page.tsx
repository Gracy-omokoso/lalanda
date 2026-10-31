// `/stocks/a-traiter` — entrées et sorties à traiter (ADR-0046 § 2.6) ; lecture
// `stock.read`, résolution `stock.move` (coût : `stock.manage`).

import type { Metadata } from 'next';

import { ATraiter } from '../_components/a-traiter';

export const metadata: Metadata = { title: 'À traiter — Stocks · Lalanda' };

export default function ATraiterPage(): React.ReactElement {
  return <ATraiter />;
}

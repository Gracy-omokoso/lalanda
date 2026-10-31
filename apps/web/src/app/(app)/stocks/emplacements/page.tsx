// `/stocks/emplacements` — emplacements (ADR-0046 § 2.2) ; lecture `stock.read`,
// gestion `stock.manage`.

import type { Metadata } from 'next';

import { Emplacements } from '../_components/emplacements';

export const metadata: Metadata = { title: 'Emplacements — Stocks · Lalanda' };

export default function EmplacementsPage(): React.ReactElement {
  return <Emplacements />;
}

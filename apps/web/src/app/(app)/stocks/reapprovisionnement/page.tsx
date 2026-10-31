// `/stocks/reapprovisionnement` — suggestions de réapprovisionnement
// (ADR-0046 § 5.1, § 6.1) ; lecture `stock.read`. Cible de la règle R16 du brief.

import type { Metadata } from 'next';

import { Reapprovisionnement } from '../_components/reapprovisionnement';

export const metadata: Metadata = { title: 'Réapprovisionnement — Stocks · Lalanda' };

export default function ReapprovisionnementPage(): React.ReactElement {
  return <Reapprovisionnement />;
}

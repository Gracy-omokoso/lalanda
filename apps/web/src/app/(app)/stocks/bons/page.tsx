// `/stocks/bons` — bons de sortie, d'entrée, de transfert, de retour et
// ajustements (ADR-0046 § 2.4) ; lecture `stock.read`, création `stock.move`
// (ajustement : `stock.manage`). `?nouveau=<type>` ouvre la fenêtre.

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Bons } from '../_components/bons';

export const metadata: Metadata = { title: 'Bons — Stocks · Lalanda' };

export default function BonsPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <Bons />
    </Suspense>
  );
}

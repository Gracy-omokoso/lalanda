// `/stocks/reglages` — réglages des stocks (ADR-0046 § 2.8) ; lecture
// `stock.read`, modification `stock.manage`.

import type { Metadata } from 'next';

import { Reglages } from '../_components/reglages';

export const metadata: Metadata = { title: 'Réglages — Stocks · Lalanda' };

export default function ReglagesPage(): React.ReactElement {
  return <Reglages />;
}

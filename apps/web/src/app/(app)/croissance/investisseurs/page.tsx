// `/croissance/investisseurs` — indicateurs investisseurs (ADR-0032 § 3).

import type { Metadata } from 'next';

import { IndicatorsPanel } from '../_components/indicators-panel';

export const metadata: Metadata = { title: 'Indicateurs investisseurs — Croissance · Lalanda' };

export default function InvestisseursPage(): React.ReactElement {
  return <IndicatorsPanel />;
}

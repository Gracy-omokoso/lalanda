// `/croissance/sante` — Business Health Score (ADR-0032 § 4).

import type { Metadata } from 'next';

import { HealthPanel } from '../_components/health-panel';

export const metadata: Metadata = { title: 'Santé — Croissance · Lalanda' };

export default function SantePage(): React.ReactElement {
  return <HealthPanel />;
}

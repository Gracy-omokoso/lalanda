// `/croissance/parcours` — Startup Journey (ADR-0032 § 5).

import type { Metadata } from 'next';

import { JourneyPanel } from '../_components/journey-panel';

export const metadata: Metadata = { title: 'Parcours — Croissance · Lalanda' };

export default function ParcoursPage(): React.ReactElement {
  return <JourneyPanel />;
}

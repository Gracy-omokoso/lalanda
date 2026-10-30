// `/rh/rapports` — effectif, entrées et sorties, absentéisme, ancienneté
// (ADR-0045 § 3.3, § 7). Lot H7.

import type { Metadata } from 'next';

import { RapportsRh } from '../_components/rapports-rh';

export const metadata: Metadata = { title: 'Rapports — Ressources humaines · Lalanda' };

export default function RapportsRhPage(): React.ReactElement {
  return <RapportsRh />;
}

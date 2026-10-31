// `/equipements/rapports` — le parc par statut, catégorie et affectation (ADR-0046 § 5.2).

import type { Metadata } from 'next';

import { Rapports } from '../_components/rapports';

export const metadata: Metadata = { title: 'Rapports — Équipements · Lalanda' };

export default function RapportsPage(): React.ReactElement {
  return <Rapports />;
}

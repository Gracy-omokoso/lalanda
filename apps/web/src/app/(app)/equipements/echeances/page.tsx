// `/equipements/echeances` — maintenances dues, couvertures qui expirent, matériel
// chez d'anciens collaborateurs (ADR-0046 § 6.6, R17).

import type { Metadata } from 'next';

import { Echeances } from '../_components/echeances';

export const metadata: Metadata = { title: 'Échéances — Équipements · Lalanda' };

export default function EcheancesPage(): React.ReactElement {
  return <Echeances />;
}

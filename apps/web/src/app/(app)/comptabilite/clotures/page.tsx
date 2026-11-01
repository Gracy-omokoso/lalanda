// `/comptabilite/clotures` — clôtures des mois et des exercices (ADR-0049 § 13) ; lecture `accounting.read`.

import type { Metadata } from 'next';

import { Clotures } from '../_components/clotures';

export const metadata: Metadata = { title: 'Clôtures — Comptabilité · Lalanda' };

export default function Page(): React.ReactElement {
  return <Clotures />;
}

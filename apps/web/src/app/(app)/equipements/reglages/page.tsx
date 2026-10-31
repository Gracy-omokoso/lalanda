// `/equipements/reglages` — catégories et réglages (ADR-0046 § 3.5).

import type { Metadata } from 'next';

import { Reglages } from '../_components/reglages';

export const metadata: Metadata = { title: 'Réglages — Équipements · Lalanda' };

export default function ReglagesPage(): React.ReactElement {
  return <Reglages />;
}

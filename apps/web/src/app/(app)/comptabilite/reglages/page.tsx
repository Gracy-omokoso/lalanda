// `/comptabilite/reglages` — activation et réglages (ADR-0049 § 13) ; lecture `accounting.read`.

import type { Metadata } from 'next';

import { Reglages } from '../_components/reglages';

export const metadata: Metadata = { title: 'Réglages — Comptabilité · Lalanda' };

export default function Page(): React.ReactElement {
  return <Reglages />;
}

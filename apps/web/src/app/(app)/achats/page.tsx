// `/achats` — vue d'ensemble des achats (ADR-0044 § 8) ; lecture `purchase.read`.

import type { Metadata } from 'next';

import { VueEnsemble } from './_components/vue-ensemble';

export const metadata: Metadata = { title: 'Achats — Lalanda' };

export default function AchatsPage(): React.ReactElement {
  return <VueEnsemble />;
}

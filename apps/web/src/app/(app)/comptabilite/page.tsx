// `/comptabilite` — vue d’ensemble de la comptabilité (ADR-0049 § 13) ; lecture `accounting.read`.

import type { Metadata } from 'next';

import { VueEnsemble } from './_components/vue-ensemble';

export const metadata: Metadata = { title: 'Comptabilité — Lalanda' };

export default function Page(): React.ReactElement {
  return <VueEnsemble />;
}

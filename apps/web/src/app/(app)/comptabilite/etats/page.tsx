// `/comptabilite/etats` — projets d’états (ADR-0049 § 13) ; lecture `accounting.read`.

import type { Metadata } from 'next';

import { Etats } from '../_components/etats';

export const metadata: Metadata = { title: 'États — Comptabilité · Lalanda' };

export default function Page(): React.ReactElement {
  return <Etats />;
}

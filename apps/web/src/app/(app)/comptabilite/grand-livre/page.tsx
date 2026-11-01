// `/comptabilite/grand-livre` — grand livre (ADR-0049 § 13) ; lecture `accounting.read`.

import type { Metadata } from 'next';

import { GrandLivre } from '../_components/livres';

export const metadata: Metadata = { title: 'Grand livre — Comptabilité · Lalanda' };

export default function Page(): React.ReactElement {
  return <GrandLivre />;
}

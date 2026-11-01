// `/comptabilite/ecritures` — écritures et « À comptabiliser » (ADR-0049 § 13) ; lecture `accounting.read`.

import type { Metadata } from 'next';

import { Ecritures } from '../_components/ecritures';

export const metadata: Metadata = { title: 'Écritures — Comptabilité · Lalanda' };

export default function Page(): React.ReactElement {
  return <Ecritures />;
}

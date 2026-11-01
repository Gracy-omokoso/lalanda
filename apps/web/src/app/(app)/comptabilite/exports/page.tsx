// `/comptabilite/exports` — exports pour l’expert-comptable (ADR-0049 § 13) ; lecture `accounting.read`.

import type { Metadata } from 'next';

import { Exports } from '../_components/exports';

export const metadata: Metadata = { title: 'Exports — Comptabilité · Lalanda' };

export default function Page(): React.ReactElement {
  return <Exports />;
}

// `/comptabilite/balance` — balance générale (ADR-0049 § 13) ; lecture `accounting.read`.

import type { Metadata } from 'next';

import { Balance } from '../_components/livres';

export const metadata: Metadata = { title: 'Balance — Comptabilité · Lalanda' };

export default function Page(): React.ReactElement {
  return <Balance />;
}

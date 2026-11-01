// `/comptabilite/tiers` — balances auxiliaires et lettrage (ADR-0049 § 13) ; lecture `accounting.read`.

import type { Metadata } from 'next';

import { Tiers } from '../_components/livres';

export const metadata: Metadata = { title: 'Clients et fournisseurs — Comptabilité · Lalanda' };

export default function Page(): React.ReactElement {
  return <Tiers />;
}

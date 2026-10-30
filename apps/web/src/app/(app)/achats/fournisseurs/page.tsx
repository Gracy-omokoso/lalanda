// `/achats/fournisseurs` — fiches fournisseurs (ADR-0044 § 3.1, § 8) ; lecture
// `purchase.read`, création `purchase.manage`.

import type { Metadata } from 'next';

import { FournisseursListe } from '../_components/fournisseurs-liste';

export const metadata: Metadata = { title: 'Fournisseurs — Achats · Lalanda' };

export default function FournisseursPage(): React.ReactElement {
  return <FournisseursListe />;
}

// `/achats/fournisseurs/[supplierId]` — fiche fournisseur 360° (ADR-0044 § 3.1.1).

import type { Metadata } from 'next';

import { FournisseurFiche } from '../../_components/fournisseur-fiche';

export const metadata: Metadata = { title: 'Fournisseur — Achats · Lalanda' };

export default async function FournisseurPage({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}): Promise<React.ReactElement> {
  const { supplierId } = await params;
  return <FournisseurFiche supplierId={supplierId} />;
}

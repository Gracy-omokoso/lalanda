// `/equipements/[assetId]` — fiche d'un équipement (ADR-0046 § 3, § 5.2, § 9).

import type { Metadata } from 'next';

import { EquipementFiche } from '../_components/equipement-fiche';

export const metadata: Metadata = { title: 'Équipement — Lalanda' };

export default async function EquipementPage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}): Promise<React.ReactElement> {
  const { assetId } = await params;
  return <EquipementFiche assetId={assetId} />;
}

// `/stocks/inventaires/[countId]` — comptage (téléphone), écarts et validation
// d'un inventaire (ADR-0046 § 2.7).

import type { Metadata } from 'next';

import { InventaireFiche } from '../../_components/inventaire-fiche';

export const metadata: Metadata = { title: 'Inventaire — Stocks · Lalanda' };

export default async function InventairePage({
  params,
}: {
  params: Promise<{ countId: string }>;
}): Promise<React.ReactElement> {
  const { countId } = await params;
  return <InventaireFiche countId={countId} />;
}

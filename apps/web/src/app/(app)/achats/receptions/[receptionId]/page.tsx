// `/achats/receptions/[receptionId]` — fiche d'une réception (ADR-0044 § 2.4, § 3.4).

import type { Metadata } from 'next';

import { ReceptionFiche } from '../../_components/reception-fiche';

export const metadata: Metadata = { title: 'Réception — Achats · Lalanda' };

export default async function ReceptionPage({
  params,
}: {
  params: Promise<{ receptionId: string }>;
}): Promise<React.ReactElement> {
  const { receptionId } = await params;
  return <ReceptionFiche receptionId={receptionId} />;
}

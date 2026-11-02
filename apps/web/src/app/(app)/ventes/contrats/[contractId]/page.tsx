// `/ventes/contrats/[contractId]` — un contrat (ADR-0050 § 9).

import type { Metadata } from 'next';

import { ContractDetail } from '../_components/contract-detail';

export const metadata: Metadata = { title: 'Contrat — Ventes · Lalanda' };

export default async function ContractPage({
  params,
}: {
  params: Promise<{ contractId: string }>;
}): Promise<React.ReactElement> {
  const { contractId } = await params;
  return <ContractDetail contractId={contractId} />;
}

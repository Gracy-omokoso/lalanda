// `/ventes/contrats` — contrats et abonnements (ADR-0050 § 9). Lecture `sales.read`.

import type { Metadata } from 'next';

import { ContractList } from './_components/contract-list';

export const metadata: Metadata = { title: 'Contrats — Ventes · Lalanda' };

export default function ContractsPage(): React.ReactElement {
  return <ContractList />;
}

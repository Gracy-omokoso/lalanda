// `/crm/comptes/[accountId]` — fiche compte 360° (ADR-0040 § 3.1.2, § 8.2).

import type { Metadata } from 'next';

import { CompteFiche } from '../../_components/compte-fiche';

export const metadata: Metadata = { title: 'Compte — CRM · Lalanda' };

export default async function ComptePage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}): Promise<React.ReactElement> {
  const { accountId } = await params;
  return <CompteFiche accountId={accountId} />;
}

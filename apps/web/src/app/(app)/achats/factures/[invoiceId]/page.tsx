// `/achats/factures/[invoiceId]` — fiche d'une facture fournisseur (ADR-0044 § 2.5,
// § 3.5, § 5) : rapprochement, validation, forçage, litige, avoir, paiements.

import type { Metadata } from 'next';

import { FactureFiche } from '../../_components/facture-fiche';

export const metadata: Metadata = { title: 'Facture fournisseur — Achats · Lalanda' };

export default async function FacturePage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}): Promise<React.ReactElement> {
  const { invoiceId } = await params;
  return <FactureFiche invoiceId={invoiceId} />;
}

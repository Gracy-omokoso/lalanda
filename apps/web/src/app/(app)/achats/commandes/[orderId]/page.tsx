// `/achats/commandes/[orderId]` — fiche d'une demande ou d'un bon de commande
// (ADR-0044 § 3.2, § 3.3) : lignes, approbations, aperçu PDF et envoi.

import type { Metadata } from 'next';

import { CommandeFiche } from '../../_components/commande-fiche';

export const metadata: Metadata = { title: 'Demande d’achat — Achats · Lalanda' };

export default async function CommandePage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}): Promise<React.ReactElement> {
  const { orderId } = await params;
  return <CommandeFiche orderId={orderId} />;
}

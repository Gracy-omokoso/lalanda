// `/ventes/commandes/[orderId]` — une commande client (ADR-0050 § 9).

import type { Metadata } from 'next';

import { OrderDetail } from '../_components/order-detail';

export const metadata: Metadata = { title: 'Commande — Ventes · Lalanda' };

export default async function OrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}): Promise<React.ReactElement> {
  const { orderId } = await params;
  return <OrderDetail orderId={orderId} />;
}

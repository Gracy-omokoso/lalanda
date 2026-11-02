// `/ventes/commandes` — commandes clients (ADR-0050 § 9). Lecture `sales.read`.

import type { Metadata } from 'next';

import { OrderList } from './_components/order-list';

export const metadata: Metadata = { title: 'Commandes — Ventes · Lalanda' };

export default function OrdersPage(): React.ReactElement {
  return <OrderList />;
}

// `/ventes/factures/nouvelle` — composition d'un document de vente (brouillon,
// pro forma). Écriture : `sales.manage` (ADR-0023 § S25e.14).

import type { Metadata } from 'next';

import { InvoiceEditor } from '../_components/invoice-editor';

export const metadata: Metadata = { title: 'Nouveau document — Ventes · Lalanda' };

export default function NewInvoicePage(): React.ReactElement {
  return <InvoiceEditor vueInitiale={null} />;
}

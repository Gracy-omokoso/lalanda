// `/ventes/encaissements` — argent reçu sur les factures, statut de règlement et
// pont vers le réalisé du plan (ADR-0031). Lecture : `sales.read` ;
// enregistrement : `sales.receipt` ; pont : `actuals.import`.

import type { Metadata } from 'next';

import { ReceiptsWorkspace } from './_components/receipts-workspace';

export const metadata: Metadata = { title: 'Encaissements — Ventes · Lalanda' };

export default function ReceiptsPage(): React.ReactElement {
  return <ReceiptsWorkspace />;
}

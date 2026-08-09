// `/organisation/facturation` — offre, consommation, historique (S21a).
// Réservé à `billing.manage`, donc au Propriétaire seul (ADR-0012 §3).

import type { Metadata } from 'next';

import { BillingPanel } from '../_components/billing-panel';

export const metadata: Metadata = { title: 'Facturation — Organisation · Lalanda' };

export default function OrganizationBillingPage(): React.ReactElement {
  return <BillingPanel />;
}

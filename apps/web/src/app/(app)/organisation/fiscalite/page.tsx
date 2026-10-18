// `/organisation/fiscalite` — identité fiscale, facture normalisée DGI et points
// de vente e-MCF (S25b — ADR-0021). Réservé à `fiscal.manage` : Propriétaire et
// Directeur financier.

import type { Metadata } from 'next';

import { FiscaliteEspace } from '../_components/normalized-invoicing-panel';

export const metadata: Metadata = { title: 'Fiscalité — Organisation · Lalanda' };

export default function OrganizationFiscalPage(): React.ReactElement {
  return <FiscaliteEspace />;
}

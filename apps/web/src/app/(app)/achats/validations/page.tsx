// `/achats/validations` — demandes qui attendent l'approbation de l'utilisateur
// (ADR-0044 § 3.2, `GET /purchases/approvals/pending`) ; `purchase.approve`.

import type { Metadata } from 'next';

import { Validations } from '../_components/validations';

export const metadata: Metadata = { title: 'À approuver — Achats · Lalanda' };

export default function ValidationsPage(): React.ReactElement {
  return <Validations />;
}

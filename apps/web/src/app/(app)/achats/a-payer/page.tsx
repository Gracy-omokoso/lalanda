// `/achats/a-payer` — échéancier, paiements et doublons probables (ADR-0044 § 3.6,
// § 8) ; lecture `purchase.read`, paiement `payables.pay`.

import type { Metadata } from 'next';

import { APayer } from '../_components/a-payer';

export const metadata: Metadata = { title: 'À payer — Achats · Lalanda' };

export default function APayerPage(): React.ReactElement {
  return <APayer />;
}

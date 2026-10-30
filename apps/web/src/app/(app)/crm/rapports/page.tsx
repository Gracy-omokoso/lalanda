// `/crm/rapports` — rapports du CRM (ADR-0040 § 7.2, § 8.2 ; lot C6) ; lecture
// `crm.read`. Chiffres du moteur, montants estimés par devise.

import type { Metadata } from 'next';

import { RapportsEcran } from './_components/rapports-ecran';

export const metadata: Metadata = { title: 'Rapports — CRM · Lalanda' };

export default function RapportsPage(): React.ReactElement {
  return <RapportsEcran />;
}

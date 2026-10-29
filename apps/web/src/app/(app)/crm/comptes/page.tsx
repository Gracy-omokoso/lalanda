// `/crm/comptes` — comptes prospects et clients (ADR-0040 § 8.1) ; lecture
// `crm.read`, création d'un prospect `crm.manage`.

import type { Metadata } from 'next';

import { ComptesListe } from '../_components/comptes-liste';

export const metadata: Metadata = { title: 'Comptes — CRM · Lalanda' };

export default function ComptesPage(): React.ReactElement {
  return <ComptesListe />;
}

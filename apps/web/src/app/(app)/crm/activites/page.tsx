// `/crm/activites` — activités et relances (ADR-0040 § 3.5, § 8.1) ; lecture
// `crm.read`, cocher / rouvrir `crm.manage`.

import type { Metadata } from 'next';

import { ActivitesListe } from '../_components/activites-liste';

export const metadata: Metadata = { title: 'Activités — CRM · Lalanda' };

export default function ActivitesPage(): React.ReactElement {
  return <ActivitesListe />;
}

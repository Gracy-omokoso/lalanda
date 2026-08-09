// `/admin/organisations` — organisations clientes (S21b).
//
// Consultable par les rôles Support, Administrateur et Super-administrateur de
// plateforme; les écritures (plan, suspension) demandent en plus
// `canManagePlatform`. Le tri est fait par l'API — le client ne réordonne pas.

import type { Metadata } from 'next';

import { OrganizationsPanel } from '../_components/organizations-panel';

export const metadata: Metadata = { title: 'Organisations — Administration · Lalanda' };

export default function AdminOrganizationsPage(): React.ReactElement {
  return <OrganizationsPanel />;
}

// `/organisation/identite` — identité visuelle : logos, couleurs, police (ADR-0028).
// Réservé à `organization.manage` : Propriétaire et Administrateur.

import type { Metadata } from 'next';

import { BrandIdentityPanel } from '../_components/brand-identity-panel';

export const metadata: Metadata = { title: 'Identité visuelle — Organisation · Lalanda' };

export default function OrganizationBrandPage(): React.ReactElement {
  return <BrandIdentityPanel />;
}

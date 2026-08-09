// `/organisation/parametres` — nom, pays, devise d'affichage, logo (S21a).
// Réservé à `organization.manage` : Propriétaire et Administrateur.

import type { Metadata } from 'next';

import { SettingsPanel } from '../_components/settings-panel';

export const metadata: Metadata = { title: 'Paramètres — Organisation · Lalanda' };

export default function OrganizationSettingsPage(): React.ReactElement {
  return <SettingsPanel />;
}

// `/organisation` — tableau de bord différencié selon le rôle (S21a).
//
// Point de montage : le chrome (titre, onglets) vit dans `layout.tsx`, la logique
// dans `_components/dashboard-panel.tsx`. Ajouter une section de l'espace se fait
// en créant un segment sous `organisation/` et une entrée dans
// `ORGANIZATION_TABS`, sans toucher aux pages existantes.

import type { Metadata } from 'next';

import { DashboardPanel } from './_components/dashboard-panel';

export const metadata: Metadata = { title: 'Tableau de bord — Organisation · Lalanda' };

export default function OrganizationDashboardPage(): React.ReactElement {
  return <DashboardPanel />;
}

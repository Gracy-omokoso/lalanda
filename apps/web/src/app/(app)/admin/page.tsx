// `/admin` — tableau de bord de la plateforme (S21b).
//
// Point de montage : le chrome (titre, onglets, porte d'entrée) vit dans
// `layout.tsx`, la logique dans `_components/overview-panel.tsx`.

import type { Metadata } from 'next';

import { OverviewPanel } from './_components/overview-panel';

export const metadata: Metadata = { title: 'Tableau de bord — Administration · Lalanda' };

export default function AdminOverviewPage(): React.ReactElement {
  return <OverviewPanel />;
}

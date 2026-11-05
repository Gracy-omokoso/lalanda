// `/rh/equipes` — équipes de l'organisation (ADR-0060 § 2) : lecture `hr.read`,
// création, membres et suppression `hr.manage`. Servies aux Projets (membres).

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Equipes } from '../_components/equipes';

export const metadata: Metadata = { title: 'Équipes — Ressources humaines · Lalanda' };

export default function EquipesPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <Equipes />
    </Suspense>
  );
}

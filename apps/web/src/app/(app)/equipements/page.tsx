// `/equipements` — registre des équipements (ADR-0046 § 3.1, § 5.2) ; lecture
// `assets.read`, création `assets.manage` (`?nouveau=1` ouvre la fenêtre), export
// `report.export`.

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Registre } from './_components/registre';

export const metadata: Metadata = { title: 'Équipements — Lalanda' };

export default function EquipementsPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <Registre />
    </Suspense>
  );
}

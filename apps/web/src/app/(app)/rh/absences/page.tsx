// `/rh/absences` — absences à valider (`?vue=a-valider`, cible du brief R14) et,
// pour `hr.read`, toutes les demandes (`?vue=toutes`). ADR-0045 § 3.2, § 8.

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Absences } from '../_components/absences';

export const metadata: Metadata = { title: 'Absences — Ressources humaines · Lalanda' };

export default function AbsencesPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <Absences />
    </Suspense>
  );
}

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { FeuilleTemps } from '../../_components/feuille-temps';

export const metadata: Metadata = { title: 'Mes tâches — feuille de temps — Lalanda' };

export default function FeuilleTempsPage(): React.ReactElement {
  // ADR-0077 § 4.6 : la feuille lit `?membre=&semaine=` (frontière de chargement exigée).
  return (
    <Suspense fallback={null}>
      <FeuilleTemps />
    </Suspense>
  );
}

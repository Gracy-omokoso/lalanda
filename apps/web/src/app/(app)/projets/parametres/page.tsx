import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ParametresProjets } from '../_components/parametres-projets';

export const metadata: Metadata = { title: 'Projets — paramètres — Lalanda' };

/** ADR-0061 : mes notifications (chacun) et comportement des projets (`work.manage`). */
export default function ParametresProjetsPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <ParametresProjets />
    </Suspense>
  );
}

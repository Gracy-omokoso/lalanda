import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ImportFichier } from '../_components/import-fichier';

export const metadata: Metadata = { title: 'Importer un fichier — Projets — Lalanda' };

/** ADR-0062 : nouveau projet depuis un fichier, ou tâches importées dans `?projet=<id>`. */
export default function ImporterPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <ImportFichier />
    </Suspense>
  );
}

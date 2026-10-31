// `/documents` — bibliothèque (ADR-0046 § 4, § 5.3) : arbre des dossiers, liste,
// recherche en corps, dépôt multipart. Seul l'identifiant du dossier ouvert figure
// dans l'adresse (`?dossier=`).

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Bibliotheque } from './_components/bibliotheque';

export const metadata: Metadata = { title: 'Documents — Lalanda' };

export default function DocumentsPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <Bibliotheque />
    </Suspense>
  );
}

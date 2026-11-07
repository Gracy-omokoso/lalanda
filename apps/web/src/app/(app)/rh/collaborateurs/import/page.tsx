// `/rh/collaborateurs/import` — import du personnel existant (ADR-0068 § 4) ;
// `hr.manage`. Aperçu ligne par ligne avant toute création.

import type { Metadata } from 'next';

import { ImportCollaborateurs } from '../../_components/import-collaborateurs';

export const metadata: Metadata = {
  title: 'Importer des collaborateurs — Ressources humaines · Lalanda',
};

export default function ImportCollaborateursPage(): React.ReactElement {
  return <ImportCollaborateurs />;
}

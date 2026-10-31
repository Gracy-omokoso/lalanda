// `/documents` — route posée par le lot S8 (ADR-0046) ; la bibliothèque arrive
// avec le lot S9, qui remplace ce fichier.

import type { Metadata } from 'next';

import { EcranAVenir } from '../_components/acces-application';

export const metadata: Metadata = { title: 'Documents — Lalanda' };

export default function DocumentsPage(): React.ReactElement {
  return (
    <EcranAVenir texte="La bibliothèque de documents arrive avec une prochaine livraison. Rien n’est affiché d’ici là plutôt que des données inventées." />
  );
}

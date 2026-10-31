// `/equipements` — route posée par le lot S8 (ADR-0046) ; le registre arrive
// avec le lot S9, qui remplace ce fichier.

import type { Metadata } from 'next';

import { EcranAVenir } from '../_components/acces-application';

export const metadata: Metadata = { title: 'Équipements — Lalanda' };

export default function EquipementsPage(): React.ReactElement {
  return (
    <EcranAVenir texte="Le registre des équipements arrive avec une prochaine livraison. Rien n’est affiché d’ici là plutôt que des données inventées." />
  );
}

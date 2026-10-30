// `/rh/collaborateurs` — liste des collaborateurs (ADR-0045 § 3.1, § 8) ;
// lecture `hr.read`, création en fenêtre modale (`hr.manage`).

import type { Metadata } from 'next';

import { CollaborateursListe } from '../_components/collaborateurs-liste';

export const metadata: Metadata = { title: 'Collaborateurs — Ressources humaines · Lalanda' };

export default function CollaborateursPage(): React.ReactElement {
  return <CollaborateursListe />;
}

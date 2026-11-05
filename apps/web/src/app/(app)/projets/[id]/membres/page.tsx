import type { Metadata } from 'next';

import { MembresProjet } from '../../_components/membres-projet';

export const metadata: Metadata = { title: 'Projet — membres — Lalanda' };

/** ADR-0060 : membres d'un projet (utilisateurs, équipes) et visibilité ; ouvert par « Partager ». */
export default function ProjetMembresPage(): React.ReactElement {
  return <MembresProjet />;
}

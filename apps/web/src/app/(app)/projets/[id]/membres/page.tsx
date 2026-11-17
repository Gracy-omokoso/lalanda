import type { Metadata } from 'next';

import { MembresExternes } from '../../_components/membres-externes';
import { MembresProjet } from '../../_components/membres-projet';

export const metadata: Metadata = { title: 'Projet — membres — Lalanda' };

/** ADR-0060 : membres d'un projet (utilisateurs, équipes) et visibilité ; ouvert par « Partager ». */
export default function ProjetMembresPage(): React.ReactElement {
  return (
    <div className="flex flex-col gap-8">
      <MembresProjet />
      {/* ADR-0078 : contacts clients et consultants (espace externe). */}
      <MembresExternes />
    </div>
  );
}

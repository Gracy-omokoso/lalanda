'use client';

import { CalendarDays } from 'lucide-react';

import { CalendrierAbsences } from './calendrier-absences';
import { porteesProposees } from './calendrier-model';
import { useAccesRh } from './rh-access';
import { peutLireRh } from './rh-model';
import { Bandeau } from './rh-ui';

export function CalendrierRh(): React.ReactElement {
  const { actions, moi } = useAccesRh();
  const isManager = moi?.ok === true && moi.valeur.isManager;
  const portees = porteesProposees({ isManager, lireRh: peutLireRh(actions) });
  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={CalendarDays}
        titre="Calendrier des absences"
        sousTitre="Qui est absent, et quand. Le type d’une absence confidentielle n’est jamais montré : « Absent »."
      />
      <CalendrierAbsences portees={portees} porteeInitiale="department" />
    </section>
  );
}

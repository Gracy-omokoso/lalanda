'use client';

// En-tête d'une idée : titre, état d'archivage et sous-onglets Fiche / Validation.

import { TabsNav } from '@lalanda/ui';

import { renderNextLink } from '@/components/next-link';
import type { IdeaView } from '@/lib/idea-lab-api';

import { Pastille } from '../../croissance/_components/grow-ui';
import { libelleScore, ongletsIdee, tonNiveau } from './idea-model';

export function IdeaHeader({
  idea,
  courant,
}: {
  idea: IdeaView;
  courant: 'fiche' | 'validation';
}): React.ReactElement {
  const s = idea.validation.score;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl font-semibold tracking-tight">{idea.title}</h2>
        <Pastille ton={s.disponible ? tonNiveau(s.niveau) : 'neutre'}>
          Validation : {libelleScore(s)}
        </Pastille>
        {idea.archived && <Pastille ton="neutre">Archivée</Pastille>}
      </div>
      <TabsNav
        label="Sections de l’idée"
        renderLink={renderNextLink}
        items={ongletsIdee(idea.id).map((o) => ({
          href: o.href,
          label: o.label,
          current: o.segment === courant,
        }))}
      />
    </div>
  );
}

import type { Metadata } from 'next';

import { IaConstruire } from '../_components/ia-construire';

export const metadata: Metadata = { title: 'Construire avec l’IA — Projets — Lalanda' };

/** ADR-0063 : l'IA propose un plan Scrum/Agile, l'équipe le relit, puis le projet est créé. */
export default function ConstruireIaPage(): React.ReactElement {
  return <IaConstruire />;
}

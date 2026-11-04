import type { Metadata } from 'next';

import { VueKanban } from '../../_components/vue-kanban';

export const metadata: Metadata = { title: 'Projet — tableau — Lalanda' };

export default function ProjetKanbanPage(): React.ReactElement {
  return <VueKanban />;
}

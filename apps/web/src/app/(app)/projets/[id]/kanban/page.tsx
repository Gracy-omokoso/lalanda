import type { Metadata } from 'next';

import { VueKanban } from '../../_components/vue-kanban';

export const metadata: Metadata = { title: 'Projet — Kanban — Lalanda' };

export default function ProjetKanbanPage(): React.ReactElement {
  return <VueKanban />;
}

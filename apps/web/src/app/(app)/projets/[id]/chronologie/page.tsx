import type { Metadata } from 'next';

import { VueChronologie } from '../../_components/gantt-vue';

export const metadata: Metadata = { title: 'Projet — Chronologie — Lalanda' };

export default function ProjetChronologiePage(): React.ReactElement {
  return <VueChronologie />;
}

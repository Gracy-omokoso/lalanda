import type { Metadata } from 'next';

import { MesTaches } from '../_components/mes-taches';

export const metadata: Metadata = { title: 'Mes tâches — Lalanda' };

export default function MesTachesPage(): React.ReactElement {
  return <MesTaches />;
}

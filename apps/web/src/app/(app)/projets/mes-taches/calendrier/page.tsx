import type { Metadata } from 'next';

import { CalendrierMesTaches } from '../../_components/calendar-mes-taches';

export const metadata: Metadata = { title: 'Mes tâches — calendrier — Lalanda' };

export default function MesTachesCalendrierPage(): React.ReactElement {
  return <CalendrierMesTaches />;
}

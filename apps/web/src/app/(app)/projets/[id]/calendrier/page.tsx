import type { Metadata } from 'next';

import { CalendrierProjet } from '../../_components/calendar-projet';

export const metadata: Metadata = { title: 'Projet — Calendrier — Lalanda' };

export default function ProjetCalendrierPage(): React.ReactElement {
  return <CalendrierProjet />;
}

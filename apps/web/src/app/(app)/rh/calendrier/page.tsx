// `/rh/calendrier` — calendrier des absences (ADR-0045 § 3.2, § 8) ; par défaut
// celles de mon service (décision ouverte n° 8).

import type { Metadata } from 'next';

import { CalendrierRh } from '../_components/calendrier-rh';

export const metadata: Metadata = { title: 'Calendrier des absences — Ressources humaines · Lalanda' };

export default function CalendrierRhPage(): React.ReactElement {
  return <CalendrierRh />;
}

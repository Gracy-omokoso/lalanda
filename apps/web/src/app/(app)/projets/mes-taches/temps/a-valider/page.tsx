import type { Metadata } from 'next';

import { TempsAValider } from '../../../_components/temps-a-valider';

export const metadata: Metadata = { title: 'Feuilles de temps à valider — Lalanda' };

// ADR-0077 § 4 : semaines soumises que l'appelant peut valider (lien du brief, R21).
export default function TempsAValiderPage(): React.ReactElement {
  return <TempsAValider />;
}

// `/rh/organigramme` — organigramme en arbre (ADR-0045 § 2.3, § 3.1) : par
// services ou par ligne hiérarchique. `hr.read`, ou tout membre relié à une fiche
// tant que `orgChartVisibility = members` (décision ouverte n° 9).

import type { Metadata } from 'next';

import { Organigramme } from '../_components/organigramme';

export const metadata: Metadata = { title: 'Organigramme — Ressources humaines · Lalanda' };

export default function OrganigrammePage(): React.ReactElement {
  return <Organigramme />;
}

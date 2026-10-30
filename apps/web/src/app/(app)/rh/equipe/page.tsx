// `/rh/equipe` — Mon équipe (ADR-0045 § 3.1, § 8) : fiches réduites, absences,
// soldes, demandes à valider et calendrier de l'équipe. `GET /hr/team`.

import type { Metadata } from 'next';

import { MonEquipe } from '../_components/mon-equipe';

export const metadata: Metadata = { title: 'Mon équipe — Ressources humaines · Lalanda' };

export default function MonEquipePage(): React.ReactElement {
  return <MonEquipe />;
}

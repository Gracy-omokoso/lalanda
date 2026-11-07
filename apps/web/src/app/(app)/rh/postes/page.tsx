// `/rh/postes` — référentiel des postes (ADR-0068 § 3) ; lecture `hr.read`,
// création, modification et suppression d'un poste vacant (`hr.manage`).

import type { Metadata } from 'next';

import { Postes } from '../_components/postes';

export const metadata: Metadata = { title: 'Postes — Ressources humaines · Lalanda' };

export default function PostesPage(): React.ReactElement {
  return <Postes />;
}

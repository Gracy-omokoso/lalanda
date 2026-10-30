// `/rh` — renvoie vers l'écran d'arrivée (ADR-0045 § 8) : la liste des
// collaborateurs avec `hr.read`, sinon « Mon espace ».

import type { Metadata } from 'next';

import { ArriveeRh } from './_components/arrivee-rh';

export const metadata: Metadata = { title: 'Ressources humaines — Lalanda' };

export default function RhPage(): React.ReactElement {
  return <ArriveeRh />;
}

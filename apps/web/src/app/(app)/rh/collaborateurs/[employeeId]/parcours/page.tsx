// Onglet « Entrées et sorties » de la fiche collaborateur (ADR-0045 § 2.9, § 3.1, § 8), lot H7.

import type { Metadata } from 'next';

import { FicheParcours } from '../../../_components/fiche-parcours';

export const metadata: Metadata = { title: 'Entrées et sorties — Collaborateur · Lalanda' };

export default function FicheParcoursPage(): React.ReactElement {
  return <FicheParcours />;
}

// Onglet « Cartes » de la fiche collaborateur (ADR-0069) : carte de service
// vérifiable et carte de visite.

import type { Metadata } from 'next';

import { FicheCartes } from '../../../_components/fiche-cartes';

export const metadata: Metadata = { title: 'Cartes — Collaborateur · Lalanda' };

export default function FicheCartesPage(): React.ReactElement {
  return <FicheCartes />;
}

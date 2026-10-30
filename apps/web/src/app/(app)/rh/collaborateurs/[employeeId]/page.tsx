// Onglet « Dossier » de la fiche collaborateur (ADR-0045 § 2.1, § 8).

import type { Metadata } from 'next';

import { FicheDossier } from '../../_components/fiche-dossier';

export const metadata: Metadata = { title: 'Collaborateur — Ressources humaines · Lalanda' };

export default function FicheDossierPage(): React.ReactElement {
  return <FicheDossier />;
}

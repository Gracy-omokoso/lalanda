// Onglet « Données sensibles » de la fiche collaborateur (ADR-0045 § 2.4, § 8), lot H7.

import type { Metadata } from 'next';

import { FicheSensible } from '../../../_components/fiche-sensible';

export const metadata: Metadata = { title: 'Données sensibles — Collaborateur · Lalanda' };

export default function FicheSensiblePage(): React.ReactElement {
  return <FicheSensible />;
}

// `/rh/reglages` — semaine de travail, année de congé, types d'absence, jours
// fériés, circuit de validation, modèles de listes (ADR-0045 § 2.2, § 3.3). Lot H7.

import type { Metadata } from 'next';

import { ReglagesRh } from '../_components/reglages-rh';

export const metadata: Metadata = { title: 'Réglages — Ressources humaines · Lalanda' };

export default function ReglagesRhPage(): React.ReactElement {
  return <ReglagesRh />;
}

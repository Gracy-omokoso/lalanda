// Onglet « Absences et soldes » de la fiche collaborateur (ADR-0045 § 3.2, § 8).

import type { Metadata } from 'next';

import { FicheAbsences } from '../../../_components/fiche-absences';

export const metadata: Metadata = { title: 'Absences — Collaborateur · Lalanda' };

export default function FicheAbsencesPage(): React.ReactElement {
  return <FicheAbsences />;
}

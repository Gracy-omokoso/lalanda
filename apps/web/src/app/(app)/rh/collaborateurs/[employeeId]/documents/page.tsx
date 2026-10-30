// Onglet « Documents » de la fiche collaborateur (ADR-0045 § 2.8, § 8), lot H7.

import type { Metadata } from 'next';

import { FicheDocuments } from '../../../_components/fiche-documents';

export const metadata: Metadata = { title: 'Documents — Collaborateur · Lalanda' };

export default function FicheDocumentsPage(): React.ReactElement {
  return <FicheDocuments />;
}

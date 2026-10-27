// `/idees/:id/validation` — grille, preuves, score du moteur et expériences (ADR-0036 § 2).

import type { Metadata } from 'next';

import { IdeaValidationPanel } from '../../_components/idea-validation-panel';

export const metadata: Metadata = { title: 'Validation de l’idée — Idea Lab · Lalanda' };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function IdeeValidationPage({ params }: Props): Promise<React.ReactElement> {
  const { id } = await params;
  return <IdeaValidationPanel id={id} />;
}

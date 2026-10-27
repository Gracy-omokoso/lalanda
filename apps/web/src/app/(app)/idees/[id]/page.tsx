// `/idees/:id` — fiche d'une idée, assistance IA, passage au plan (ADR-0036 § 1, § 3, § 4).

import type { Metadata } from 'next';

import { IdeaFichePanel } from '../_components/idea-fiche-panel';

export const metadata: Metadata = { title: 'Idée — Idea Lab · Lalanda' };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function IdeePage({ params }: Props): Promise<React.ReactElement> {
  const { id } = await params;
  return <IdeaFichePanel id={id} />;
}

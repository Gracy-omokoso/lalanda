// `/stocks/articles/[itemId]` — fiche d'un article (ADR-0046 § 2.1, § 5.1) :
// quantités par emplacement, coût moyen et valeur (si visibles), seuil, constats,
// derniers mouvements.

import type { Metadata } from 'next';

import { ArticleFiche } from '../../_components/article-fiche';

export const metadata: Metadata = { title: 'Article — Stocks · Lalanda' };

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}): Promise<React.ReactElement> {
  const { itemId } = await params;
  return <ArticleFiche itemId={itemId} />;
}

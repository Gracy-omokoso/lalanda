import { ActualsPanel } from '../../_components/actuals-panel';

interface Props {
  params: Promise<{ id: string }>;
}

// Route de l'onglet « Réalisé » (S18b). Le fil d'Ariane et les onglets projet
// vivent dans `layout.tsx` (S18d) : cette page ne rend que son contenu.
//
// Le réalisé est une section à part entière et non une vue du plan : plan validé
// et réalisé sont deux concepts distincts (docs/08), et l'onglet « Plan » garde
// son propre `?tab=` pour les feuilles de résultats.
export default async function ProjectRealisePage({ params }: Props): Promise<React.ReactElement> {
  const { id } = await params;
  return <ActualsPanel projectId={id} />;
}

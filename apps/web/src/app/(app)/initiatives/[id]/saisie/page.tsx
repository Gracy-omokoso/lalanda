import { ProjectWizard } from '../../_components/project-wizard';

interface Props {
  params: Promise<{ id: string }>;
}

// Route de l'onglet « Saisie » (S23a). Le fil d'Ariane et les onglets projet
// vivent dans `layout.tsx` (S18d) : cette page ne rend que son contenu.
//
// L'assistant est une route à part entière et non un mode de la page projet :
// son URL est partageable, le retour navigateur fonctionne, et `?champ=<driver>`
// ouvre directement l'étape qui porte ce champ — c'est ce que vise le renvoi
// « Corriger… » depuis l'écran de résultats.
export default async function ProjectSaisiePage({ params }: Props): Promise<React.ReactElement> {
  const { id } = await params;
  return <ProjectWizard projectId={id} />;
}

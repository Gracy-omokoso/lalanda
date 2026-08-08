import { ProjectPlan } from '../_components/project-plan';

interface Props {
  params: Promise<{ id: string }>;
}

// Fil d'Ariane et onglets projet vivent dans `layout.tsx` (S18d).
//
// (S18c) Le wizard de saisie n'ajoute PAS d'entrée à `PROJECT_TABS` : il remplace la
// saisie de cette page plutôt que de vivre à côté. Saisie guidée et résultats sont
// deux colonnes d'un même écran — les séparer en deux onglets casserait l'aperçu de
// l'impact d'une hypothèse, qui est l'intérêt du parcours. L'onglet « Plan » reste
// donc le point d'entrée unique.
export default async function ProjectDetailPage({ params }: Props): Promise<React.ReactElement> {
  const { id } = await params;
  return <ProjectPlan projectId={id} />;
}

import { ProjectPlan } from '../_components/project-plan';

interface Props {
  params: Promise<{ id: string }>;
}

// Fil d'Ariane et onglets projet vivent dans `layout.tsx` (S18d).
export default async function ProjectDetailPage({ params }: Props): Promise<React.ReactElement> {
  const { id } = await params;
  return <ProjectPlan projectId={id} />;
}

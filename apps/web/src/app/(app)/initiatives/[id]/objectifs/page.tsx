import { ObjectivesPanel } from '../_components/objectives-panel';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProjectObjectivesPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  return <ObjectivesPanel projectId={id} />;
}

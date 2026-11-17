// `/portail/projets/[projectId]` — un projet vu de l'espace externe (ADR-0078).

import { ProjetPortail } from '../../_components/espace-portail';

export default async function PortailProjetPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}): Promise<React.ReactElement> {
  const { projectId } = await params;
  return <ProjetPortail projectId={projectId} />;
}

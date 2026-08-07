import { CanvasBoard } from '../_components/canvas-board';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProjectCanvasPage({ params }: Props): Promise<React.ReactElement> {
  const { id } = await params;
  return <CanvasBoard projectId={id} />;
}

import Link from 'next/link';

import { ProjectPlan } from '../_components/project-plan';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProjectDetailPage({ params }: Props): Promise<React.ReactElement> {
  const { id } = await params;
  return (
    <section className="flex flex-col gap-4">
      <nav className="text-xs opacity-60">
        <Link href="/projects" className="hover:underline">
          ← Mes projets
        </Link>
      </nav>
      <ProjectPlan projectId={id} />
    </section>
  );
}

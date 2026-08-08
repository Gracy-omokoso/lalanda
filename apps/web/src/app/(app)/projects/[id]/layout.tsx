import Link from 'next/link';

import { ProjectTabs } from './_components/project-tabs';

interface Props {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}

/**
 * Chrome commun aux sections d'un projet (S18d) : fil d'Ariane + onglets
 * Plan / Canvas / Objectifs. Les pages filles ne rendent que leur contenu.
 */
export default async function ProjectLayout({
  params,
  children,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  return (
    <section className="flex flex-col gap-4">
      <nav className="text-xs opacity-60">
        <Link href="/projects" className="hover:underline">
          ← Mes projets
        </Link>
      </nav>
      <ProjectTabs projectId={id} />
      {children}
    </section>
  );
}

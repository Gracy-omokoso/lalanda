import { ModuleMark } from '@lalanda/ui';
import Link from 'next/link';

import { ProjectTabs } from './_components/project-tabs';

interface Props {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}

/**
 * Chrome commun aux sections d'un projet (S18d, ADR-0030) : fil d'Ariane qui
 * situe le projet dans le module BUILD, puis les onglets. Les pages filles ne
 * rendent que leur contenu.
 */
export default async function ProjectLayout({
  params,
  children,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="flex flex-wrap items-center gap-2 text-xs">
        <ModuleMark module="build" />
        <span aria-hidden="true" className="text-[var(--foreground-muted)]">
          /
        </span>
        <Link
          href="/initiatives"
          className="font-medium text-[var(--foreground-muted)] underline-offset-2 hover:text-[var(--foreground)] hover:underline"
        >
          Initiatives
        </Link>
      </nav>
      <ProjectTabs projectId={id} />
      {children}
    </section>
  );
}

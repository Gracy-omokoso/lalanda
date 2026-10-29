import { Suspense } from 'react';

import { EnteteProjet } from '../_components/entete-projet';
import { PanneauTache } from '../_components/panneau-tache';
import { ProjetProvider } from '../_components/project-context';

/**
 * Page d'un projet (ADR-0039 § 8) : en-tête et onglets, la vue de l'onglet,
 * et le panneau de tâche (`?tache=<id>`) commun à toutes les vues. Le
 * contexte (`useProjet()`) est le point de branchement des vues du lot L3b.
 */
export default async function ProjetLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <ProjetProvider projectId={id}>
        <section className="flex min-w-0 flex-col gap-5">
          <EnteteProjet />
          <div className="min-w-0">{children}</div>
        </section>
        <PanneauTache />
      </ProjetProvider>
    </Suspense>
  );
}

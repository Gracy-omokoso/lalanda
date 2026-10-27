import { PageHeader } from '@lalanda/ui';

import { IdeesChrome } from './_components/idees-chrome';

/**
 * Idea Lab — l'amont de BUILD (ADR-0036) : décrire ses idées, les valider sur une
 * grille explicite avec des preuves, puis passer la meilleure au Canvas et au
 * plan financier. Exige une organisation active ; lecture ouverte à tous les rôles
 * (`project.read`), écriture à ceux qui écrivent le Canvas (`canvas.update`).
 */
export default function IdeesLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        module="build"
        moduleLabel="Concevoir"
        title="Idea Lab"
        description="Décrivez vos idées, vérifiez-les auprès de vrais clients, comparez-les, puis passez la meilleure au Canvas et au plan financier. Aucun chiffre de marché n’est inventé : chacun porte sa source."
      />
      <IdeesChrome>{children}</IdeesChrome>
    </section>
  );
}

import { PageHeader } from '@lalanda/ui';

import { AccesApplication } from '../_components/acces-application';

/**
 * Application Équipements (module RUN) — ADR-0046 § 3, coquille du lot S8.
 *
 * Pas de rangée d'onglets (ADR-0038 § 3) : la colonne de gauche est la seule
 * navigation. Frontière d'accès `assets.read`. Les écrans (registre, fiche,
 * échéances) arrivent avec le lot S9, qui écrit tout `equipements/**` sauf ce
 * fichier ; d'ici là l'application reste masquée de la navigation.
 */
export default function EquipementsLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-5 sm:gap-6">
      <PageHeader
        module="run"
        moduleLabel="Exploiter"
        title="Équipements"
        description="Le matériel de l’organisation : qui l’a, son entretien, ses garanties et assurances. Les coûts ne s’affichent qu’aux rôles qui voient les prix d’achat ou la trésorerie."
      />
      <AccesApplication
        action="assets.read"
        titreRefus="Les équipements ne sont pas ouverts à votre rôle"
        texteRefus="Si vous en avez besoin, demandez à un Propriétaire ou un Administrateur de l’organisation de revoir vos droits."
      >
        {children}
      </AccesApplication>
    </section>
  );
}

import { PageHeader } from '@lalanda/ui';

import { RhChrome } from './_components/rh-access';

/**
 * Application Ressources humaines (module RUN) — ADR-0045 § 8, lot H6.
 *
 * Pas de rangée d'onglets (ADR-0038 § 3) : Mon espace, Mon équipe, À valider,
 * Calendrier, Collaborateurs, Services et Organigramme sont dans la colonne de
 * gauche. L'en-tête et la frontière d'accès (`leave.request` ou `hr.read`) sont
 * communs à tous les écrans, y compris ceux du lot H7 (données sensibles,
 * documents, parcours, échéances, rapports, réglages), qui utilisent cette
 * coquille sans l'écrire.
 */
export default function RhLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-5 sm:gap-6">
      <PageHeader
        module="run"
        moduleLabel="Exploiter"
        title="Ressources humaines"
        description="Votre espace, vos absences, votre équipe et les dossiers du personnel. Les jours et les soldes sont ceux calculés par Lalanda ; ce que vous voyez dépend de vos droits."
      />
      <RhChrome>{children}</RhChrome>
    </section>
  );
}

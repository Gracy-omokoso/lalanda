import { PageHeader } from '@lalanda/ui';

import { AccesApplication } from '../_components/acces-application';

/**
 * Application Documents (module RUN) — ADR-0046 § 4, coquille du lot S8.
 *
 * Pas de rangée d'onglets (ADR-0038 § 3). Frontière d'accès `docs.read` ; les
 * dossiers restreignent ensuite (droits jugés par l'API). Les écrans
 * (bibliothèque, envoi, versions, échéances) arrivent avec le lot S9, qui écrit
 * tout `documents/**` sauf ce fichier ; d'ici là l'application reste masquée.
 */
export default function DocumentsLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-5 sm:gap-6">
      <PageHeader
        module="run"
        moduleLabel="Exploiter"
        title="Documents"
        description="La bibliothèque de l’entreprise : statuts, attestations, contrats, polices d’assurance, avec leurs versions et leurs dates d’expiration."
      />
      <AccesApplication
        action="docs.read"
        titreRefus="La bibliothèque n’est pas ouverte à votre rôle"
        texteRefus="Si vous en avez besoin, demandez à un Propriétaire ou un Administrateur de l’organisation de revoir vos droits."
      >
        {children}
      </AccesApplication>
    </section>
  );
}

import { PageHeader } from '@lalanda/ui';

import { CrmChrome } from './_components/crm-access';

/**
 * Application CRM (module RUN) — ADR-0040 § 8.1, amende ADR-0038 § 2.
 *
 * Sortie de l'espace Ventes : le commercial travaille l'opportunité avant de
 * facturer. Les anciennes URL `/ventes/crm/**` répondent 308 vers `/crm/**`
 * (`next.config.mjs`).
 *
 * Pas de rangée d'onglets (ADR-0038 § 3, révision du 29 oct. 2026) : Pipeline,
 * Contacts et Réglages sont dans la colonne de gauche. L'en-tête et la
 * frontière d'accès (`crm.read`) sont communs à tous les écrans, y compris ceux
 * des lots suivants (comptes, activités, rapports).
 *
 * Comme `/ventes`, l'application EXIGE une organisation active : toutes ses
 * routes d'API sont scopées par l'organisation du cookie.
 */
export default function CrmLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <section className="flex flex-col gap-5 sm:gap-6">
      <PageHeader
        module="run"
        moduleLabel="Exploiter"
        title="CRM"
        description="Votre pipeline d’opportunités, vos contacts et prospects, vos relances. Les montants sont estimés ; ce que vous pouvez modifier dépend de votre rôle."
      />
      <CrmChrome>{children}</CrmChrome>
    </section>
  );
}

import { PageHeader } from '@lalanda/ui';

import { AchatsChrome } from './_components/achats-access';

/**
 * Application Achats (module RUN) — ADR-0044 § 8, lot P7.
 *
 * Pas de rangée d'onglets (ADR-0038 § 3) : vue d'ensemble, demandes et
 * commandes, approbations et fournisseurs sont dans la colonne de gauche.
 * L'en-tête et la frontière d'accès (`purchase.read`) sont communs à tous les
 * écrans, y compris ceux du lot P8 (réceptions, factures, à payer), qui
 * utilisent cette coquille sans l'écrire.
 */
export default function AchatsLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-5 sm:gap-6">
      <PageHeader
        module="run"
        moduleLabel="Exploiter"
        title="Achats"
        description="Vos fournisseurs, vos demandes d’achat et leurs approbations, vos bons de commande. Les montants sont ceux calculés par Lalanda ; ce que vous pouvez faire dépend de vos droits."
      />
      <AchatsChrome>{children}</AchatsChrome>
    </section>
  );
}

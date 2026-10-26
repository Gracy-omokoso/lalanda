import { PageHeader } from '@lalanda/ui';

import { TreasuryChrome } from './_components/treasury-access';

/**
 * Espace Trésorerie (ADR-0034) : dépenses, comptes et soldes, prévision, et
 * comparaison du réalisé au plan BUILD. Exige une organisation active ; les
 * onglets sont filtrés par `GET /me/permissions` (`treasury.read`).
 */
export default function TreasuryLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-5 sm:gap-6">
      <PageHeader
        module="run"
        moduleLabel="Exploiter"
        title="Trésorerie"
        description="Vos dépenses, vos comptes (caisse, banque, mobile money), ce qu’il vous restera dans 7, 30, 90 et 180 jours, et l’écart entre ce que vous dépensez et ce que prévoyait votre plan."
      />
      <TreasuryChrome>{children}</TreasuryChrome>
    </section>
  );
}

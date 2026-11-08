import { TreasuryChrome } from './_components/treasury-access';
import { TreasuryHeader } from './_components/treasury-header';

/**
 * Espace Trésorerie (ADR-0034) : dépenses, comptes et soldes, prévision, et
 * comparaison du réalisé au plan BUILD. Exige une organisation active ; les
 * onglets sont filtrés par `GET /me/permissions` (`treasury.read`).
 *
 * ADR-0071 : Dépenses et Comptes portent leur propre en-tête compact
 * (`TreasuryHeader`).
 */
export default function TreasuryLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-5 sm:gap-6">
      <TreasuryHeader />
      <TreasuryChrome>{children}</TreasuryChrome>
    </section>
  );
}

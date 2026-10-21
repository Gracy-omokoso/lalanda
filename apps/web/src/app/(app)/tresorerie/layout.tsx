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
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">Trésorerie</h1>
        <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
          Vos dépenses, vos comptes (caisse, banque, mobile money), ce qu’il vous restera dans 7,
          30, 90 et 180 jours, et l’écart entre ce que vous dépensez et ce que prévoyait votre plan.
        </p>
      </header>
      <TreasuryChrome>{children}</TreasuryChrome>
    </section>
  );
}
